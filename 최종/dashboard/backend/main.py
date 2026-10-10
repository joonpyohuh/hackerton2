"""Run: uvicorn backend.main:app --host 127.0.0.1 --port 8000"""
import csv
import io
import json
import math
import secrets
import sqlite3
import threading
import time
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from fastapi import Depends, FastAPI, HTTPException, Query, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse
from pydantic import BaseModel, Field
from . import settings,db,analysis,ai,relations

@asynccontextmanager
async def lifespan(app):
    db.initialize()
    yield

app=FastAPI(title='OTT Pulse Dashboard API',version='1.0.0',lifespan=lifespan)
app.add_middleware(CORSMiddleware,allow_origins=settings.ALLOWED_ORIGINS,allow_methods=['GET','POST'],allow_headers=['Content-Type','X-Admin-Token'])

class Filters(BaseModel):
    from_date: str | None=None
    to_date: str | None=None
    dev: str='all'
    age: str='all'
    gen: str='all'
    push: str='all'

class StrategyRequest(BaseModel):
    target_id: str
    filters: Filters=Field(default_factory=Filters)

class ChatRequest(BaseModel):
    target_id:str|None=None
    filters:Filters=Field(default_factory=Filters)
    message:str=Field(min_length=1,max_length=2000)
    history:list[dict[str,str]]=Field(default_factory=list,max_length=8)


def authorized(token:str|None=Header(default=None,alias='X-Admin-Token')):
    if not settings.ADMIN_TOKEN:
        raise HTTPException(503,'ADMIN_TOKEN must be set on the server for protected operations')
    if not token or not secrets.compare_digest(token,settings.ADMIN_TOKEN):
        raise HTTPException(401,'관리자 인증 토큰이 필요합니다')
    return True

class SlidingWindowLimiter:
    """In-memory, per-process sliding window. Not shared across workers/instances."""
    def __init__(self,clock=time.monotonic):
        self._hits:dict[str,deque[float]]={}
        self._lock=threading.Lock()
        self._clock=clock
    def hit(self,key:str,limit:int,window:float)->int|None:
        """Record a hit; return retry-after seconds if over the limit, else None."""
        now=self._clock()
        with self._lock:
            q=self._hits.setdefault(key,deque())
            while q and now-q[0]>=window: q.popleft()
            if len(q)>=limit: return max(1,math.ceil(window-(now-q[0])))
            q.append(now)
            if len(self._hits)>4096:
                for k in [k for k,v in self._hits.items() if not v or now-v[-1]>=window]: del self._hits[k]
            return None
    def reset(self):
        with self._lock: self._hits.clear()

ai_limiter=SlidingWindowLimiter()

def client_ip(request:Request)->str:
    if settings.TRUST_PROXY_HEADERS:
        fwd=request.headers.get('x-forwarded-for','').split(',')[0].strip()
        if fwd: return fwd
    return request.client.host if request.client else 'unknown'

def ai_rate_limited(request:Request):
    if settings.AI_RATE_LIMIT<=0: return
    retry=ai_limiter.hit(client_ip(request),settings.AI_RATE_LIMIT,settings.AI_RATE_WINDOW_SECONDS)
    if retry is not None:
        span=lambda s:f'{math.ceil(s/60)}분' if s>=60 else f'{s}초'
        raise HTTPException(429,f'AI 분석 요청 한도({span(settings.AI_RATE_WINDOW_SECONDS)}에 {settings.AI_RATE_LIMIT}회)를 넘었습니다. 약 {span(retry)} 후 다시 시도해 주세요.',
                            headers={'Retry-After':str(retry)})

def make_filters(**kwargs):return {k:v for k,v in kwargs.items() if v is not None}

def safely(work):
    try:
        with db.connect() as c: return work(c)
    except (ValueError, KeyError) as ex: raise HTTPException(400,str(ex)) from ex
    except RuntimeError as ex: raise HTTPException(503,str(ex)) from ex

@app.get('/api/health')
def health():
    def go(c):
        m=db.active(c)
        return {'ok':True,'snapshot_id':m['id'],'imported_at':m['imported_at'],'customers':m['customer_count'],
                'ai_configured':bool(settings.OPENAI_API_KEY),'ai_provider':'openai','model':settings.OPENAI_MODEL}
    return safely(go)

@app.get('/api/snapshots')
def snapshots():
    return safely(lambda c: {'active':db.active(c)['id'],'items':[dict(r) for r in c.execute('SELECT id,imported_at,customer_count FROM snapshots ORDER BY imported_at DESC')]})

@app.post('/api/snapshots/refresh',dependencies=[Depends(authorized)])
def refresh():
    return safely(lambda c: db.import_snapshot(c))

@app.get('/api/overview')
def overview(from_date:str|None=None,to_date:str|None=None,dev:str='all',age:str='all',gen:str='all',push:str='all'):
    f=make_filters(from_date=from_date,to_date=to_date,dev=dev,age=age,gen=gen,push=push)
    return safely(lambda c:analysis.overview(c,f))

@app.get('/api/targets')
def targets(from_date:str|None=None,to_date:str|None=None,dev:str='all',age:str='all',gen:str='all',push:str='all'):
    f=make_filters(from_date=from_date,to_date=to_date,dev=dev,age=age,gen=gen,push=push)
    return safely(lambda c:analysis.list_summaries(c,f))

@app.get('/api/targets/{target_id}/sql')
def sql(target_id:str,from_date:str|None=None,to_date:str|None=None,dev:str='all',age:str='all',gen:str='all',push:str='all'):
    f=make_filters(from_date=from_date,to_date=to_date,dev=dev,age=age,gen=gen,push=push)
    return safely(lambda c:analysis.sql_text(c,target_id,f))

@app.get('/api/targets/{target_id}/customers',dependencies=[Depends(authorized)])
def customers(target_id:str,from_date:str|None=None,to_date:str|None=None,dev:str='all',age:str='all',gen:str='all',push:str='all',push_only:bool=False,limit:int=Query(100,ge=1,le=500),offset:int=Query(0,ge=0)):
    f=make_filters(from_date=from_date,to_date=to_date,dev=dev,age=age,gen=gen,push=push)
    return safely(lambda c:analysis.customers(c,target_id,f,push_only,limit,offset))

@app.get('/api/targets/{target_id}/export',dependencies=[Depends(authorized)])
def export(target_id:str,from_date:str|None=None,to_date:str|None=None,dev:str='all',age:str='all',gen:str='all',push:str='all',push_only:bool=False):
    f=make_filters(from_date=from_date,to_date=to_date,dev=dev,age=age,gen=gen,push=push)
    def go(c):
        output=io.StringIO(newline='')
        wr=csv.DictWriter(output,fieldnames=['user_key','signup_date','signup_device_type','age_band','push_opt_in_current'])
        wr.writeheader()
        total=0
        while True:
            part=analysis.customers(c,target_id,f,push_only,50000,total)
            for r in part['rows']:wr.writerow(r)
            total+=len(part['rows'])
            if total>=part['total'] or not part['rows']:break
        return Response(content='\ufeff'+output.getvalue(),media_type='text/csv; charset=utf-8',
           headers={'Content-Disposition':f'attachment; filename="{target_id}_{"push" if push_only else "all"}.csv"','Cache-Control':'no-store'})
    return safely(go)

# AI analysis is aggregate-only (no customer rows) → public, but rate-limited per client IP.
@app.post('/api/ai/strategy',dependencies=[Depends(ai_rate_limited)])
def strategy(req:StrategyRequest):
    def go(c):
        s=analysis.summary(c,req.target_id,req.filters.model_dump(exclude_none=True))
        return s
    s=safely(go)
    try: result=ai.call(ai.strategy_prompt(s),structured=True)
    except ai.AINotConfigured as ex: raise HTTPException(503,str(ex))
    except ai.AICallFailed as ex: raise HTTPException(502,str(ex))
    now=datetime.now(timezone.utc).isoformat()
    with db.connect() as c:
        cur=c.execute('INSERT INTO recommendations(created_at,snapshot_id,target_id,filters_json,summary_json,result_json,model) VALUES(?,?,?,?,?,?,?)',
          (now,s['snapshot_id'],req.target_id,req.filters.model_dump_json(),json.dumps(s,ensure_ascii=False),json.dumps(result,ensure_ascii=False),settings.OPENAI_MODEL))
        c.commit()
        return {'id':cur.lastrowid,'created_at':now,'snapshot_id':s['snapshot_id'],'summary':s,'strategy':result,'model':settings.OPENAI_MODEL}

@app.post('/api/ai/chat',dependencies=[Depends(ai_rate_limited)])
def chat(req:ChatRequest):
    s=safely(lambda c:analysis.summary(c,req.target_id,req.filters.model_dump(exclude_none=True)) if req.target_id and req.target_id!='all' else analysis.list_summaries(c,req.filters.model_dump(exclude_none=True)))
    try: response=ai.call(ai.chat_prompt(s,req.history,req.message),structured=False)
    except ai.AINotConfigured as ex: raise HTTPException(503,str(ex))
    except ai.AICallFailed as ex: raise HTTPException(502,str(ex))
    return {'reply':response,'snapshot_id':s.get('snapshot_id',s.get('snapshot')),'model':settings.OPENAI_MODEL}

@app.get('/api/recommendations')
def recommendations(target_id:str|None=None,limit:int=Query(20,ge=1,le=100)):
    if target_id is not None and target_id not in analysis.TARGETS:raise HTTPException(400,'Unknown target')
    def go(c):
        q='SELECT id,created_at,snapshot_id,target_id,filters_json,summary_json,result_json,model FROM recommendations'
        p=[]
        if target_id:q+=' WHERE target_id=?';p.append(target_id)
        q+=' ORDER BY id DESC LIMIT ?';p.append(limit)
        out=[]
        for r in c.execute(q,p):
            d=dict(r)
            for k in ('filters_json','summary_json','result_json'):d[k[:-5]]=json.loads(d.pop(k))
            out.append(d)
        return {'items':out}
    return safely(go)

@app.get('/api/relations')
def relation_facts(from_date:str|None=None,to_date:str|None=None,dev:str='all',age:str='all',gen:str='all',push:str='all'):
    f=make_filters(from_date=from_date,to_date=to_date,dev=dev,age=age,gen=gen,push=push)
    return safely(lambda c:relations.compute(c,f))

class RelationRequest(BaseModel):
    filters: Filters=Field(default_factory=Filters)

@app.post('/api/relations/analyze',dependencies=[Depends(ai_rate_limited)])
def relation_analyze(req:RelationRequest):
    # Aggregate-only (no customer rows), same public tier as /api/relations.
    # Costs an OpenAI call per request → shares the per-IP AI rate limit.
    facts=safely(lambda c:relations.compute(c,req.filters.model_dump(exclude_none=True)))
    prompt,pool=relations.analysis_prompt(facts)
    if not pool: raise HTTPException(422,'현재 필터에서 통계적으로 유의한 연관이 없습니다. 필터 범위를 넓혀 주세요.')
    started=datetime.now(timezone.utc)
    try: raw=ai.complete(prompt,system=relations.SYSTEM_FACT,json_mode=True)
    except ai.AINotConfigured as ex: raise HTTPException(503,str(ex))
    except ai.AICallFailed as ex: raise HTTPException(502,str(ex))
    result=relations.verify(raw,facts,pool)
    return {**result,'snapshot_id':facts['snapshot_id'],'model':settings.OPENAI_MODEL,'edges_considered':len(pool),
            'elapsed_ms':int((datetime.now(timezone.utc)-started).total_seconds()*1000),'created_at':started.isoformat()}

# React relation explorer (web/ → npm run build → web/dist), served under /insights
@app.get('/insights')
def insights_page():
    page=settings.WEB_DIST/'index.html'
    if not page.is_file(): raise HTTPException(404,'web/dist가 없습니다. web 폴더에서 npm install && npm run build 를 실행하세요.')
    return FileResponse(page,headers={'Cache-Control':'no-store'})

@app.get('/insights/assets/{asset_name}')
def insights_asset(asset_name:str):
    path=(settings.WEB_DIST/'assets'/asset_name).resolve()
    if path.parent!=(settings.WEB_DIST/'assets').resolve() or not path.is_file(): raise HTTPException(404,'Not found')
    return FileResponse(path,headers={'Cache-Control':'public, max-age=31536000, immutable'})

# Strict static allowlist: never expose .env, runtime/*.sqlite3, backend/, etc.
# data.js contains pseudonymous per-customer features: DEMO ONLY (not a public production deployment).
@app.get('/')
def homepage(): return FileResponse(settings.ROOT/'index.html', headers={'Cache-Control':'no-store'})

@app.get('/{asset_name}')
def static_asset(asset_name: str):
    if asset_name not in ('app.js','ai.js','data.js'):
        raise HTTPException(404,'Not found')
    return FileResponse(settings.ROOT/asset_name,media_type='application/javascript',headers={'Cache-Control':'no-store'})
