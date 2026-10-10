/* OTT Pulse AI assistant: server-origin API, no OpenAI key in browser code. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const els = {
    dock:$('aiDock'), panel:$('aiPanel'), close:$('aiClose'), status:$('aiStatus'),
    target:$('aiTarget'), advanced:$('aiAdvanced'), summary:$('aiSummary'), result:$('aiResult'),
    answer:$('aiAnswer'), input:$('aiQuestion'), suggested:$('aiSuggested'), generate:$('aiGenerate'), ask:$('aiAsk'),
    history:$('aiHistory'), reload:$('aiReload'), sql:$('aiSql'), events:$('aiEvents'),
  };
  const CHAT=[];
  let lastSnapshot=null;
  let visible=false;
  let refreshBusy=false;
  let busy=false;
  let historyItems=[];
  let returnFocus=null;
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
  async function request(path, options={}){
    const headers={...options.headers};
    if(options.body && typeof options.body!=='string'){
      headers['Content-Type']='application/json'; options.body=JSON.stringify(options.body);
    }
    let resp;
    try{resp=await fetch('/api'+path,{...options,headers,cache:'no-store'});}
    catch(e){throw Error('서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');}
    if(!resp.ok){
      let info={};try{info=await resp.json();}catch{}
      const err=Error(typeof info.detail==='string' ? info.detail : `HTTP ${resp.status}`);
      err.status=resp.status;
      throw err;
    }
    return resp;
  }
  async function json(path,opts={}){return (await request(path,opts)).json();}
  // kind: '' | 'busy' | 'notice' | 'error'
  let statusSeq=0;
  function status(txt,kind=''){
    statusSeq++;
    if(kind===true) kind='error';
    els.status.textContent=txt;
    els.status.className='ai-status'+(kind?' '+kind:'');
  }
  // 429 (rate limit) is an expected pause, not a failure → calmer notice styling.
  const errKind=e=>e.status===429?'notice':'error';
  function setBusy(on){
    busy=on;
    [els.generate,els.ask,els.sql,els.target,els.input].forEach(x=>{x.disabled=on;});
    els.panel.setAttribute('aria-busy',on?'true':'false');
  }
  const skeleton='<div class="ai-skeleton ai-in" aria-hidden="true"><i></i><i></i><i></i><i></i></div>';

  function updateResults(h){
    const c=h.kpis;
    els.summary.textContent=`현재 데이터: 가입 ${pretty(c.n)}명 · D+30 결제 ${pretty(c.p30)}명 · 지속 시청 ${pretty(c.retained)}명`;
    els.events.innerHTML=h.targets.map(t=>{
      const change=t.change ? ` · 이전 대비 ${t.change.delta_count>=0?'+':''}${pretty(t.change.delta_count)}명` : ' · 최초 스냅샷';
      return `<button class="ai-target-chip" data-choose="${t.id}"><strong>${t.id}</strong> ${esc(t.name)} <b>${pretty(t.count)}</b>명 · 푸시 <b>${pretty(t.push_reachable)}</b>명${esc(change)}</button>`;
    }).join('');
  }
  async function refreshStatus(){
    const seq=statusSeq;  // don't clobber a message written while this request was in flight
    try{
      const [health,overview]=await Promise.all([json('/health'),json('/overview?'+qs())]);
      lastSnapshot=health.snapshot_id;
      if(!busy && seq===statusSeq) status(health.ai_configured
        ? `고객 ${pretty(health.customers)}명 데이터 준비됨`
        : 'AI 연결을 확인할 수 없습니다.', health.ai_configured?'':'notice');
      updateResults(overview);
    }catch(e){if(seq===statusSeq) status(e.message,'error');}
  }
  function open(t){
    const changed=!busy && t && t!==els.target.value;  // never swap target under an in-flight request
    if(changed){els.target.value=t;clearTarget();}
    if(t && t!=='all') els.advanced.open=true;
    const wasVisible=visible;
    if(!visible){
      returnFocus=document.activeElement;
      visible=true;els.panel.classList.add('open');els.dock.setAttribute('aria-expanded','true');
      els.panel.setAttribute('aria-hidden','false');
      // focus after the slide starts so the browser does not jump-scroll
      requestAnimationFrame(()=>els.input.focus({preventScroll:true}));
    }
    if(changed||!wasVisible){refreshStatus();loadHistory();}
  }
  function close(){
    visible=false;els.panel.classList.remove('open');els.dock.setAttribute('aria-expanded','false');els.panel.setAttribute('aria-hidden','true');
    if(returnFocus && returnFocus.focus && document.contains(returnFocus)) returnFocus.focus({preventScroll:true});
    else els.dock.focus({preventScroll:true});
  }
  function renderStrategy(x){
    const s=x.strategy;
    const labels={headline:'핵심 제안',observation:'데이터 근거',objective:'캠페인 목표',exclusions:'제외 대상',send_timing:'발송 시점·횟수',channel:'활용 채널',message:'메시지 문안',personalization:'개인화',content_recommendation:'콘텐츠·상품 추천',expected_impact:'기대효과',kpi:'측정 KPI',ab_test:'A/B 테스트',priority_reason:'우선순위 근거',limitations:'주의사항'};
    els.result.innerHTML='<div class="ai-result-head ai-in">'+esc(s.headline||'GPT 캠페인 제안')+'<small>저장 #'+x.id+' · '+esc(x.created_at||'')+'</small></div>'+
    Object.entries(labels).map(([k,v],i)=>`<div class="ai-result-row ai-in" style="--i:${i+1}"><strong>${v}</strong><p>${esc(s[k]||'—')}</p></div>`).join('');
    els.result.scrollTop=0;
  }
  async function generate(){
    if(busy)return;
    if(els.target.value==='all'){status('캠페인 전략을 생성하려면 T1~T3 중 타깃을 선택해 주세요. 전체 비교는 아래 질문창에서 할 수 있습니다.','notice');els.input.focus();return;}
    const label=els.generate.textContent;
    setBusy(true);els.generate.textContent='분석 중…';
    els.result.innerHTML=skeleton;
    status('선택한 고객 데이터를 분석하고 있습니다.','busy');
    try{
      const x=await json('/ai/strategy',{method:'POST',body:{target_id:els.target.value,filters:config()}});
      renderStrategy(x);
      status(`분석 완료 · 이력 #${x.id}로 저장했습니다.`);
      els.generate.textContent='다시 분석';
      loadHistory();
    }catch(e){
      els.result.innerHTML=`<p class="ai-notice ai-in">${esc(e.message)}</p>`;
      status(e.message,errKind(e));
      els.generate.textContent=label;
    }
    finally{setBusy(false);}
  }
  function bubble(role,text){
    const d=document.createElement('div');d.className='ai-msg ai-in '+role;d.textContent=text;
    els.answer.appendChild(d);return d;
  }
  async function ask(){
    const msg=els.input.value.trim();if(!msg||busy)return;
    setBusy(true);
    const mine=bubble('user',msg);els.input.value='';
    const typing=document.createElement('div');typing.className='ai-typing ai-in';typing.setAttribute('aria-label','GPT 응답 작성 중');typing.innerHTML='<i></i><i></i><i></i>';
    els.answer.appendChild(typing);
    status('고객 데이터를 바탕으로 답변하고 있습니다.','busy');
    try{
      const result=await json('/ai/chat',{method:'POST',body:{target_id:els.target.value,filters:config(),message:msg,history:CHAT.slice(-8)}});
      CHAT.push({role:'user',text:msg},{role:'assistant',text:result.reply});
      typing.remove();bubble('assistant',result.reply);
      status('답변 완료');
      els.answer.scrollIntoView({block:'nearest'});
    }catch(e){
      // drop the unanswered bubble and restore the question so it can be resent
      typing.remove();mine.remove();bubble(errKind(e),e.message);
      if(!els.input.value) els.input.value=msg;
      status(e.message,errKind(e));
    }
    finally{setBusy(false);els.input.focus({preventScroll:true});}
  }
  async function loadHistory(){
    const target=els.target.value;
    try{
      const d=await json('/recommendations?'+(target==='all'?'':'target_id='+encodeURIComponent(target)+'&')+'limit=6');
      if(target!==els.target.value) return;  // target changed mid-request
      historyItems=d.items;
      els.history.innerHTML=d.items.length
        ? d.items.map((r,i)=>`<button type="button" class="ai-history-item ai-in" style="--i:${i}" data-rec="${r.id}"><strong>#${r.id} ${esc(r.result.headline||'GPT 전략')}</strong><small>${esc(r.created_at)} · ${esc(r.snapshot_id)}</small></button>`).join('')
        : '<p class="ai-empty ai-in">이 타깃으로 저장된 전략이 아직 없습니다. 분석을 시작하면 자동 저장됩니다.</p>';
    }catch(e){els.history.innerHTML=`<p class="ai-empty">${esc(e.message)}</p>`;}
  }
  async function showSql(){
    if(els.target.value==='all'){status('전체 비교는 T1~T3 SQL 집계에 기반합니다. 각 타깃을 선택해 SQL을 확인하세요.','notice');return;}
    try{const d=await json('/targets/'+els.target.value+'/sql?'+qs());
      els.result.innerHTML='';
      const pre=document.createElement('pre');pre.className='ai-in';
      pre.textContent=d.sql+'\n\n-- SQL 파라미터\n'+JSON.stringify(d.parameters,null,2);
      els.result.appendChild(pre);
      status('현재 화면의 필터와 동일한 SQL 조건');
    }catch(e){status(e.message,'error');}
  }
  function clearTarget(){
    CHAT.length=0;els.answer.innerHTML='';
    els.result.innerHTML='<p class="ai-empty">타깃을 선택해 전략을 만들 수 있습니다.</p>';
    els.generate.textContent='전략 만들기';
  }
  function resetTarget(){clearTarget();loadHistory();refreshStatus();}
  els.dock.addEventListener('click',()=>visible?close():open());
  els.close.addEventListener('click',close);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&visible)close();});
  els.generate.addEventListener('click',generate);els.ask.addEventListener('click',ask);
  els.suggested.addEventListener('click',()=>{els.target.value='all';clearTarget();els.input.value='가장 타깃으로 할 만한 집단이 뭐야?';ask();});
  els.input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();ask();}});
  els.history.addEventListener('click',e=>{
    const b=e.target.closest('[data-rec]');if(!b)return;
    const r=historyItems.find(x=>String(x.id)===b.dataset.rec);
    if(r){renderStrategy({strategy:r.result,id:r.id,created_at:r.created_at});status(`저장된 전략 #${r.id}을 표시합니다.`);}
  });
  els.reload.addEventListener('click',loadHistory);els.sql.addEventListener('click',showSql);
  els.target.addEventListener('change',resetTarget);
  els.events.addEventListener('click',e=>{const b=e.target.closest('[data-choose]');if(b)open(b.dataset.choose);});
  document.addEventListener('ott:render',()=>{if(visible)refreshStatus();});
  // Avoid hidden autonomous model calls. Poll only snapshot metadata when panel open.
  setInterval(async()=>{if(!visible||refreshBusy)return;refreshBusy=true;
    try{const h=await json('/health');if(lastSnapshot&&h.snapshot_id!==lastSnapshot){status('새 데이터 스냅샷 감지됨. 갱신 내용을 확인하세요.','notice');await refreshStatus();}}
    catch{}finally{refreshBusy=false;}
  },60000);
  window.OTT_AI={open,refreshStatus};
  refreshStatus();
})();
