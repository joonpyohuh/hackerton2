/* OTT Pulse AI assistant: server-origin API, no OpenAI key in browser code. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const els = {
    dock:$('aiDock'), panel:$('aiPanel'), close:$('aiClose'), status:$('aiStatus'),
    target:$('aiTarget'), key:$('aiToken'), summary:$('aiSummary'), result:$('aiResult'),
    answer:$('aiAnswer'), input:$('aiQuestion'), generate:$('aiGenerate'), ask:$('aiAsk'),
    history:$('aiHistory'), reload:$('aiReload'), sql:$('aiSql'), updated:$('aiUpdated'),
    events:$('aiEvents'), refreshData:$('aiRefreshData'),
  };
  const CHAT=[];
  let lastSnapshot=null;
  let visible=false;
  let refreshBusy=false;
  const esc = x => String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pretty=n => Number(n||0).toLocaleString('ko-KR');
  const config=()=>({
    from_date:document.getElementById('from').value,
    to_date:document.getElementById('to').value,
    dev:document.getElementById('dev').value,
    age:document.getElementById('age').value,
    gen:document.getElementById('gen').value,
    push:document.getElementById('push').value
  });
  const qs=()=>new URLSearchParams(config()).toString();
  const key=()=>els.key.value.trim();
  async function request(path, options={}){
    const headers={...options.headers};
    if(key()) headers['X-Admin-Token']=key();
    if(options.body && typeof options.body!=='string'){
      headers['Content-Type']='application/json'; options.body=JSON.stringify(options.body);
    }
    let resp;
    try{resp=await fetch('/api'+path,{...options,headers,cache:'no-store'});}
    catch(e){throw Error('백엔드에 연결할 수 없습니다. python -m uvicorn backend.main:app 명령으로 서버를 실행하세요.');}
    if(!resp.ok){
      let info={};try{info=await resp.json();}catch{}
      throw Error(info.detail || `HTTP ${resp.status}`);
    }
    return resp;
  }
  async function json(path,opts={}){return (await request(path,opts)).json();}
  function status(txt,error=false){els.status.textContent=txt;els.status.classList.toggle('error',error);}
  function updateResults(h){
    const c=h.kpis;
    $('aiSummary').textContent=`SQL 기준: 가입 ${pretty(c.n)}명 · D+30 결제 ${pretty(c.p30)}명 · 지속 시청 ${pretty(c.retained)}명`;
    $('aiUpdated').textContent=`활성 데이터 스냅샷: ${h.snapshot_id}`;
    $('aiEvents').innerHTML=h.targets.map(t=>{
      const change=t.change ? ` · 이전 대비 ${t.change.delta_count>=0?'+':''}${pretty(t.change.delta_count)}명` : ' · 최초 스냅샷';
      return `<button class="ai-target-chip" data-choose="${t.id}"><strong>${t.id}</strong> ${esc(t.name)} <b>${pretty(t.count)}</b>명 · 푸시 <b>${pretty(t.push_reachable)}</b>명${esc(change)}</button>`;
    }).join('');
  }
  async function refreshStatus(){
    try{
      const [health,overview]=await Promise.all([json('/health'),json('/overview?'+qs())]);
      lastSnapshot=health.snapshot_id;
      status(`서버 연결 · ${pretty(health.customers)}명 · GPT ${health.ai_configured?'설정됨':'키 미설정'}`);
      updateResults(overview);
    }catch(e){status(e.message,true);}
  }
  function open(t){
    if(t) els.target.value=t;
    visible=true;els.panel.classList.add('open');els.dock.setAttribute('aria-expanded','true');
    els.panel.setAttribute('aria-hidden','false');
    refreshStatus();
  }
  function close(){visible=false;els.panel.classList.remove('open');els.dock.setAttribute('aria-expanded','false');els.panel.setAttribute('aria-hidden','true');}
  function renderStrategy(x){
    const s=x.strategy;
    const labels={headline:'핵심 제안',observation:'데이터 근거',objective:'캠페인 목표',exclusions:'제외 대상',send_timing:'발송 시점·횟수',channel:'활용 채널',message:'메시지 문안',personalization:'개인화',content_recommendation:'콘텐츠·상품 추천',expected_impact:'기대효과',kpi:'측정 KPI',ab_test:'A/B 테스트',priority_reason:'우선순위 근거',limitations:'주의사항'};
    els.result.innerHTML='<div class="ai-result-head">'+esc(s.headline||'GPT 캠페인 제안')+'<small>저장 #'+x.id+' · '+esc(x.created_at||'')+'</small></div>'+
    Object.entries(labels).map(([k,v])=>`<div class="ai-result-row"><strong>${v}</strong><p>${esc(s[k]||'—')}</p></div>`).join('');
  }
  async function generate(){
    els.generate.disabled=true;els.generate.textContent='GPT 전략 생성 중...';
    status('현재 필터 기준 SQL 데이터를 GPT에 전달하고 있습니다.');
    try{
      const x=await json('/ai/strategy',{method:'POST',body:{target_id:els.target.value,filters:config()}});
      renderStrategy(x);
      status(`GPT 전략 생성 및 SQLite 이력 저장 완료 #${x.id}`);
      await loadHistory();
    }catch(e){status(e.message,true);}
    finally{els.generate.disabled=false;els.generate.textContent='GPT 전략 생성 · 저장';}
  }
  async function ask(){
    const msg=els.input.value.trim();if(!msg)return;
    els.ask.disabled=true;els.answer.textContent='GPT 응답 요청 중...';
    try{
      const result=await json('/ai/chat',{method:'POST',body:{target_id:els.target.value,filters:config(),message:msg,history:CHAT.slice(-8)}});
      CHAT.push({role:'user',text:msg},{role:'assistant',text:result.reply});
      els.answer.textContent=result.reply;els.input.value='';status('선택한 타깃 데이터 근거 응답 · 캠페인 발송 기능 없음');
    }catch(e){els.answer.textContent='';status(e.message,true);}
    finally{els.ask.disabled=false;}
  }
  async function loadHistory(){
    try{
      const d=await json('/recommendations?target_id='+encodeURIComponent(els.target.value)+'&limit=6');
      els.history.innerHTML=d.items.length?d.items.map(r=>`<div class="ai-history-item"><strong>#${r.id} ${esc(r.result.headline||'GPT 전략')}</strong><small>${esc(r.created_at)} · ${esc(r.snapshot_id)}</small></div>`).join(''):'저장된 GPT 추천이 없습니다.';
    }catch(e){els.history.textContent=e.message;}
  }
  async function showSql(){
    try{const d=await json('/targets/'+els.target.value+'/sql?'+qs());
      els.result.textContent=d.sql+'\n\n-- SQL 파라미터\n'+JSON.stringify(d.parameters,null,2);
      status('현재 화면의 필터와 동일한 SQL 조건');
    }catch(e){status(e.message,true);}
  }
  async function exportTarget(t,push){
    if(!key()){open(t);status('고객 CSV 추출에는 서버 ADMIN_TOKEN 입력이 필요합니다.',true);els.key.focus();return;}
    try{
      const resp=await request('/targets/'+t+'/export?'+qs()+'&push_only='+(push?'true':'false'));
      const blob=await resp.blob();
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=url;link.download=t+'_'+(push?'push':'all')+'.csv';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1200);
      status('서버 SQL 기반 CSV 추출 완료');
    }catch(e){open(t);status(e.message,true);}
  }
  async function reload(){
    if(!key()){status('데이터 재적재에는 ADMIN_TOKEN이 필요합니다.',true);return;}
    try{
      const res=await json('/snapshots/refresh',{method:'POST'});
      status(res.changed?'새 스냅샷을 저장했습니다. 페이지를 새로고침하면 업데이트된 data.js가 반영됩니다.':'입력 데이터가 동일해 기존 스냅샷을 유지합니다.');
      await refreshStatus();
      if(res.changed){els.result.textContent='데이터 파일 변경이 감지되었습니다. 새 data.js를 브라우저에도 반영하려면 새로고침하세요.';}
    }catch(e){status(e.message,true);}
  }
  els.dock.addEventListener('click',()=>visible?close():open());
  els.close.addEventListener('click',close);
  els.generate.addEventListener('click',generate);els.ask.addEventListener('click',ask);
  els.input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask();}});
  els.history.addEventListener('click',e=>{});
  els.reload.addEventListener('click',loadHistory);els.sql.addEventListener('click',showSql);
  els.refreshData.addEventListener('click',reload);
  els.target.addEventListener('change',()=>{CHAT.length=0;els.answer.textContent='';loadHistory();refreshStatus();});
  $('aiEvents').addEventListener('click',e=>{const b=e.target.closest('[data-choose]');if(b)open(b.dataset.choose);});
  document.addEventListener('ott:render',()=>{if(visible)refreshStatus();});
  // Avoid hidden autonomous model calls. Poll only snapshot metadata when panel open.
  setInterval(async()=>{if(!visible||refreshBusy)return;refreshBusy=true;
    try{const h=await json('/health');if(lastSnapshot&&h.snapshot_id!==lastSnapshot){status('새 데이터 스냅샷 감지됨. 갱신 내용을 확인하세요.');await refreshStatus();}}
    catch{}finally{refreshBusy=false;}
  },60000);
  window.OTT_AI={open,exportTarget,refreshStatus};
  refreshStatus();
})();
