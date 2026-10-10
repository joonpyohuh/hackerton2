"""Server-side OpenAI (GPT) adapter. Never fabricates an AI response without a key."""
import json
import time
import httpx
from . import settings

URL = 'https://api.openai.com/v1/chat/completions'

SYSTEM = """당신은 OTT 마케팅 데이터 분석가입니다. 제공한 SQL 집계 수치에만 근거하세요.
가설·추정·인과 해석을 만들지 마세요. 데이터로 확인된 사실(관찰)과 그 사실에 직접 근거한 실행안만 쓰세요.
효과 숫자를 지어내지 마세요. 입력에 없는 수치는 쓰지 마세요.
push_opt_in_current=1만 푸시 가능하며 발송 이전 이미 전환한 대상은 제외하세요.
고객의 개인키는 입력되지 않습니다. 콘텐츠 장르는 사후 시청으로 계산된 정보일 수 있으니
실제 발송시점 추천 근거가 아님을 명시하세요. 캠페인 전송을 수행했다고 말하지 마세요.
현재 데이터는 비식별 역사적 코호트의 스냅샷이며 실시간 데이터가 아닙니다. change=null이면 과거 버전과 비교 불가하며, 수치 변화가 없는 척하지 마세요.
반드시 한글로 간결하고 실행 가능한 답변을 만드세요."""
FIELDS = ('headline','observation','objective','exclusions','send_timing',
          'channel','message','personalization','content_recommendation','expected_impact',
          'kpi','ab_test','priority_reason','limitations')

class AINotConfigured(RuntimeError): pass
class AICallFailed(RuntimeError): pass

def _call_error(ex, model):
    """User-facing diagnostics without leaking API keys or request contents."""
    if isinstance(ex, httpx.ReadTimeout):
        return (f'OpenAI 모델({model}) 응답 대기 시간 초과. '
                '인터넷/프록시 연결 또는 모델 지연을 확인하고, '
                'python check_openai.py로 연결을 진단하세요.')
    if isinstance(ex, httpx.ConnectTimeout):
        return 'OpenAI 서버 연결 시간 초과. 네트워크/DNS/프록시를 확인하세요.'
    if isinstance(ex, httpx.ConnectError):
        return 'OpenAI 서버 연결 실패. 인터넷/DNS/회사·학교 네트워크 차단 여부를 확인하세요.'
    if isinstance(ex, httpx.HTTPStatusError):
        code = ex.response.status_code
        if code in (400, 404):
            return f'OpenAI API HTTP {code}: 요청 또는 모델 이름을 확인하세요 (현재 모델: {model}).'
        if code in (401, 403):
            return f'OpenAI API HTTP {code}: OPENAI_API_KEY 및 프로젝트 접근 권한을 확인하세요.'
        if code == 429:
            return 'OpenAI API HTTP 429: 할당량 또는 요청 빈도 제한입니다. 잠시 뒤 다시 시도하거나 사용량을 확인하세요.'
        if code in (500, 502, 503, 504):
            return f'OpenAI API HTTP {code}: 서버 과부하 또는 일시 오류입니다. 재시도해 보세요.'
        return f'OpenAI API HTTP {code}: 모델 및 API 설정을 확인하세요.'
    return f'OpenAI API 호출 실패: {type(ex).__name__}: {str(ex)[:150]}'


def complete(prompt, *, system=SYSTEM, json_mode=False, transport=None):
    """One chat completion. Returns the raw text (or parsed dict in json_mode)."""
    if not settings.OPENAI_API_KEY:
        raise AINotConfigured('OPENAI_API_KEY 환경변수가 없습니다. 라이브 GPT 호출을 사용할 수 없습니다.')
    model=settings.OPENAI_MODEL
    payload={'model':model,'messages':[{'role':'system','content':system},{'role':'user','content':prompt}]}
    if settings.OPENAI_REASONING_EFFORT: payload['reasoning_effort']=settings.OPENAI_REASONING_EFFORT
    if json_mode: payload['response_format']={'type':'json_object'}
    timeout=httpx.Timeout(connect=settings.OPENAI_CONNECT_TIMEOUT_SECONDS,
                          read=settings.OPENAI_READ_TIMEOUT_SECONDS,write=15.0,pool=10.0)
    max_attempts=1+settings.OPENAI_MAX_RETRIES
    for attempt in range(max_attempts):
        try:
            with httpx.Client(timeout=timeout,transport=transport) as client:
                r=client.post(URL,json=payload,headers={'Authorization':'Bearer '+settings.OPENAI_API_KEY})
                r.raise_for_status()
                content=r.json()['choices'][0]['message'].get('content') or ''
                if not content.strip(): raise AICallFailed('GPT 응답에 텍스트가 없습니다.')
                if json_mode:
                    data=json.loads(content)
                    if not isinstance(data,dict): raise AICallFailed('GPT JSON 응답 형식이 잘못되었습니다.')
                    return data
                return content[:10000]
        except (httpx.TimeoutException,httpx.ConnectError,httpx.HTTPStatusError) as ex:
            temporary=(isinstance(ex,(httpx.TimeoutException,httpx.ConnectError)) or
                       (isinstance(ex,httpx.HTTPStatusError) and ex.response.status_code in (408,429,500,502,503,504)))
            if temporary and attempt+1 < max_attempts:
                time.sleep(min(2**attempt,2))
                continue
            raise AICallFailed(_call_error(ex,model)) from ex
        except (httpx.HTTPError, ValueError, IndexError, KeyError) as ex:
            raise AICallFailed(f'GPT 응답 해석 실패: {type(ex).__name__}') from ex

def call(prompt, *, structured=False, transport=None):
    if structured:
        data=complete(prompt,json_mode=True,transport=transport)
        return {key:str(data.get(key,''))[:4000] for key in FIELDS}
    return complete(prompt,transport=transport)

def strategy_prompt(summary):
    return ('다음 SQL 집계 요약을 토대로 1개 캠페인 제안 JSON을 작성하세요.\n'
            +'필수 JSON 문자열 키: '+', '.join(FIELDS)+'\n'
            +'각 키에는 관찰 근거(입력 수치 그대로), 전환 목표, 제외 대상, 발송일·횟수, 수신 가능 채널, 메시지 예문,'
            +'개인화, 콘텐츠 추천의 근거, 수치가 아닌 기대효과, 실험 KPI와 A/B 실험 설계, 위험을 포함하세요.\n'
            +'가설이나 원인 추정은 쓰지 말고, 검증이 필요한 부분은 A/B 테스트로만 표현하세요.\n'
            +json.dumps(summary,ensure_ascii=False))

def chat_prompt(summary,history,message):
    history=[{'role':str(x.get('role','user')),'text':str(x.get('text',''))[:1500]} for x in history[-8:]]
    return ('현재 타깃 요약:\n'+json.dumps(summary,ensure_ascii=False)
      +'\n최근 대화:\n'+json.dumps(history,ensure_ascii=False)
      +'\n사용자 질문:\n'+message[:2000]+'\n데이터에서 확인되지 않는 사항은 확실하지 않다고 답하세요. 가설을 만들지 마세요.')
