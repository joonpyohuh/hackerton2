import csv
import io
import json
import httpx
import pytest
from fastapi.testclient import TestClient

@pytest.fixture(scope='module')
def client(tmp_path_factory):
    from backend import settings
    settings.DB_PATH=tmp_path_factory.mktemp('database')/'test.sqlite3'
    settings.ADMIN_TOKEN='unit-test-strong-token'
    settings.OPENAI_API_KEY=''
    from backend.main import app
    with TestClient(app) as test_client:
        yield test_client

TOKEN={'X-Admin-Token':'unit-test-strong-token'}


def test_serve_and_safety(client):
    assert client.get('/').status_code==200
    assert 'AI Marketing Strategist' in client.get('/').text
    assert client.get('/app.js').status_code==200
    assert client.get('/ai.js').status_code==200
    assert client.get('/data.js').status_code==200
    assert client.get('/backend/main.py').status_code==404
    assert client.get('/.env').status_code==404
    assert client.get('/insights/assets/../../.env').status_code==404
    assert client.get('/runtime/ott_pulse.sqlite3').status_code==404
    health=client.get('/api/health').json()
    assert health['ok'] and health['customers']==50000
    assert health['ai_configured'] is False


def test_kpis_and_targets(client):
    d=client.get('/api/overview').json()
    assert d['kpis']['n']==50000
    assert d['kpis']['p30']==12468
    assert d['kpis']['a7']==9897
    assert d['kpis']['retained']==6103
    assert [(t['id'],t['count'],t['push_reachable']) for t in d['targets']] == [
        ('T1',18991,8152),('T2',2571,929),('T3',4244,1638)]
    assert sum(t['count'] for t in d['targets'])==25806


def test_filters_match_sql_and_csv(client):
    filters='from_date=2025-02-01&to_date=2025-02-28&dev=2&age=8&push=1'
    targets=client.get('/api/targets?'+filters).json()['targets']
    assert all(t['count']==t['push_reachable'] for t in targets)
    for t in targets:
        target=t['id']
        s=client.get(f'/api/targets/{target}/sql?'+filters).json()
        assert 'device=:dev' in s['sql'] and 'age=:age' in s['sql'] and 'push=:push' in s['sql']
        exported=client.get(f'/api/targets/{target}/export?'+filters,headers=TOKEN)
        assert exported.status_code==200
        rows=list(csv.DictReader(io.StringIO(exported.content.decode('utf-8-sig'))))
        assert len(rows)==t['count']
        assert all(row['signup_device_type']=='ios' and row['age_band']=='UNKNOWN' and row['push_opt_in_current']=='1' for row in rows)
        page=client.get(f'/api/targets/{target}/customers?'+filters+'&limit=10',headers=TOKEN)
        assert page.status_code==200 and page.json()['total']==t['count']
        assert len(page.json()['rows'])==min(10,t['count'])


@pytest.fixture(autouse=True)
def fresh_ai_limit():
    from backend import main
    main.ai_limiter.reset()
    yield
    main.ai_limiter.reset()


def test_protection_and_validation(client):
    # Customer-level extraction and data mutation stay admin-only.
    assert client.get('/api/targets/T1/export').status_code==401
    assert client.get('/api/targets/T1/customers').status_code==401
    assert client.post('/api/snapshots/refresh').status_code==401
    assert client.get('/api/targets/T1/export',headers={'X-Admin-Token':'wrong'}).status_code==401
    assert client.get('/api/overview?from_date=not-a-date').status_code==400
    assert client.get('/api/targets/X/sql').status_code==400
    assert client.get('/api/targets/T1/customers',headers=TOKEN,params={'limit':1000}).status_code==422


def test_snapshot_reload_idempotent(client):
    before=client.get('/api/health').json()['snapshot_id']
    r=client.post('/api/snapshots/refresh',headers=TOKEN)
    assert r.status_code==200 and r.json()['changed'] is False
    assert client.get('/api/health').json()['snapshot_id']==before


def test_ai_requires_key_and_does_not_fabricate(client):
    # No admin token: AI analysis is public now; without an OpenAI key it fails with 503, never 401.
    r=client.post('/api/ai/strategy',json={'target_id':'T1'})
    assert r.status_code==503 and 'OPENAI_API_KEY' in r.json()['detail']
    r=client.post('/api/ai/chat',json={'target_id':'T2','message':'전략은?'})
    assert r.status_code==503
    r=client.get('/api/recommendations')
    assert r.status_code==200 and r.json()['items']==[]
    assert client.get('/api/recommendations?target_id=X').status_code==400


def test_ai_endpoints_open_without_token(client,monkeypatch):
    from backend import ai,settings
    settings.OPENAI_API_KEY='fake-test-key'
    monkeypatch.setattr(ai,'call',lambda prompt,structured=False,transport=None:
                        ({f:'모의 응답' for f in ai.FIELDS} if structured else '모의 채팅'))
    try:
        assert client.post('/api/ai/strategy',json={'target_id':'T3'}).status_code==200
        assert client.post('/api/ai/chat',json={'target_id':'T3','message':'요약'}).json()['reply']=='모의 채팅'
        assert client.get('/api/recommendations?target_id=T3').status_code==200
    finally:
        settings.OPENAI_API_KEY=''


def test_ai_rate_limit_returns_429(client,monkeypatch):
    from backend import ai,settings
    monkeypatch.setattr(settings,'AI_RATE_LIMIT',2)
    monkeypatch.setattr(settings,'AI_RATE_WINDOW_SECONDS',600)
    settings.OPENAI_API_KEY='fake-test-key'
    monkeypatch.setattr(ai,'call',lambda prompt,structured=False,transport=None:'모의 채팅')
    try:
        body={'target_id':'T1','message':'질문'}
        assert client.post('/api/ai/chat',json=body).status_code==200
        assert client.post('/api/ai/chat',json=body).status_code==200
        r=client.post('/api/ai/chat',json=body)
        assert r.status_code==429
        assert '한도' in r.json()['detail'] and int(r.headers['retry-after'])>0
        # Shared bucket across all AI endpoints; non-AI endpoints are unaffected.
        assert client.post('/api/ai/strategy',json={'target_id':'T1'}).status_code==429
        assert client.post('/api/relations/analyze',json={}).status_code==429
        assert client.get('/api/recommendations').status_code==200
        assert client.get('/api/overview').status_code==200
    finally:
        settings.OPENAI_API_KEY=''


def test_rate_limiter_window_and_keys():
    from backend.main import SlidingWindowLimiter
    now=[0.0]  # 가짜 시계 — 실행 속도와 무관하게 결정론적으로 검사한다
    lim=SlidingWindowLimiter(clock=lambda:now[0])
    assert lim.hit('a',2,60) is None and lim.hit('a',2,60) is None
    now[0]=10.0
    assert lim.hit('a',2,60)==50  # 첫 요청 후 60초가 지나야 풀린다
    assert lim.hit('b',2,60) is None  # per-client buckets
    now[0]=60.0
    assert lim.hit('a',2,60) is None  # window slides


def test_ai_mock_response_saved_and_chat(client,monkeypatch):
    from backend import ai,settings
    settings.OPENAI_API_KEY='fake-test-key'
    def fake_call(prompt,structured=False,transport=None):
        if structured:
            assert '18991' in prompt and '8152' in prompt
            return {f:'검증된 테스트 응답' for f in ai.FIELDS} | {'headline':'T1 테스트 전략'}
        assert 'T2' in prompt
        return '테스트 채팅 응답'
    monkeypatch.setattr(ai,'call',fake_call)
    result=client.post('/api/ai/strategy',json={'target_id':'T1'}).json()
    assert result['id']>=1 and result['strategy']['headline']=='T1 테스트 전략'
    history=client.get('/api/recommendations?target_id=T1').json()['items']
    assert history and history[0]['result']['headline']=='T1 테스트 전략'
    chat=client.post('/api/ai/chat',json={'target_id':'T2','message':'캠페인'}).json()
    assert chat['reply']=='테스트 채팅 응답'
    settings.OPENAI_API_KEY=''


def test_openai_http_payload_mock(monkeypatch):
    from backend import ai,settings
    settings.OPENAI_API_KEY='fake-test-key'
    def handler(req):
        assert str(req.url)=='https://api.openai.com/v1/chat/completions'
        assert req.headers['authorization']=='Bearer fake-test-key'
        body=json.loads(req.content)
        assert body['response_format']=={'type':'json_object'}
        assert body['messages'][0]['role']=='system'
        return httpx.Response(200,json={'choices':[{'message':{'content':'{"headline":"success","observation":"SQL 자료"}'}}]})
    result=ai.call('test',structured=True,transport=httpx.MockTransport(handler))
    assert result['headline']=='success'
    assert result['observation']=='SQL 자료'
    settings.OPENAI_API_KEY=''


def test_relations_facts_are_deterministic(client):
    d=client.get('/api/relations').json()
    assert d['n']==50000 and d['payers']==12468
    e={x['id']:x for x in d['edges']}['voucher__paid30']
    t=e['table']
    assert sum(t.values())==50000 and t['both']+t['b_only']==12468
    assert abs(e['p_b_given_a']-t['both']/(t['both']+t['a_only']))<1e-12
    assert all(x['population']=='payers' for x in d['edges'] if 'retained' in (x['source'],x['target']))
    assert not any({x['source'],x['target']}=={'dev_ios','dev_pc'} for x in d['edges'])  # mutually exclusive skipped
    assert client.get('/api/relations?dev=2').json()['n']<50000


def test_relations_analyze_rejects_unverified(client,monkeypatch):
    from backend import ai,settings
    # No admin token needed (aggregate-only endpoint) — just needs an OpenAI key configured.
    assert client.post('/api/relations/analyze',json={}).status_code==503
    settings.OPENAI_API_KEY='fake-test-key'
    edges=client.get('/api/relations').json()['edges']
    top=edges[0]
    good=f"A 고객의 B 비율은 {top['p_b_given_a']*100:.1f}%다."
    def fake(prompt,system=None,json_mode=False,transport=None):
        return {'headline':'연관 요약','recommended_view':'radial','focus_nodes':[top['source'],'nope'],
                'findings':[{'edge_ids':[top['id']],'title':'사실','fact':good,'use':'타깃 정의에 사용','viz':'donut'},
                            {'edge_ids':[top['id']],'title':'가짜 숫자','fact':'B 비율은 99.9%다.','viz':'bar'},
                            {'edge_ids':[top['id']],'title':'인과','fact':'A 때문에 B가 늘었다.','viz':'bar'},
                            {'edge_ids':['made_up__edge'],'title':'없는 엣지','fact':'사실','viz':'bar'}]}
    monkeypatch.setattr(ai,'complete',fake)
    r=client.post('/api/relations/analyze',json={}).json()
    assert r['recommended_view']=='radial' and r['focus_nodes']==[top['source']]
    assert [f['title'] for f in r['findings']]==['사실'] and r['findings'][0]['viz']=='donut'
    reasons=' '.join(x['reason'] for x in r['rejected'])
    assert '99.9%' in reasons and '때문' in reasons and 'edge_id' in reasons
    settings.OPENAI_API_KEY=''
