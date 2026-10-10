import httpx
import pytest
from backend import ai,settings

@pytest.fixture(autouse=True)
def fake_config(monkeypatch):
    monkeypatch.setattr(settings,'OPENAI_API_KEY','fake-key')
    monkeypatch.setattr(settings,'OPENAI_MODEL','gpt-5.4-mini')
    monkeypatch.setattr(settings,'OPENAI_MAX_RETRIES',1)
    monkeypatch.setattr(settings,'OPENAI_CONNECT_TIMEOUT_SECONDS',10)
    monkeypatch.setattr(settings,'OPENAI_READ_TIMEOUT_SECONDS',90)
    monkeypatch.setattr(ai.time,'sleep',lambda t:None)

def ok(text): return httpx.Response(200,json={'choices':[{'message':{'content':text}}]})

def test_timeout_retries_once():
    calls=[]
    def handler(req):
        calls.append(1)
        raise httpx.ReadTimeout('no reply')
    with pytest.raises(ai.AICallFailed,match='응답 대기 시간 초과'):
        ai.call('hello',transport=httpx.MockTransport(handler))
    assert len(calls)==2

def test_503_retry_then_success():
    calls=[]
    def handler(req):
        calls.append(1)
        if len(calls)==1: return httpx.Response(503)
        return ok('ok')
    assert ai.call('hello',transport=httpx.MockTransport(handler))=='ok'
    assert len(calls)==2

def test_403_no_retry():
    calls=[]
    def handler(req):
        calls.append(1)
        return httpx.Response(403)
    with pytest.raises(ai.AICallFailed,match='API_KEY'):
        ai.call('hello',transport=httpx.MockTransport(handler))
    assert len(calls)==1
