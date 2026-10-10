"""Check OpenAI model access and one tiny generation. Run from dashboard folder:
python check_openai.py
"""
import os
from pathlib import Path
import sys
import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')
key = os.getenv('OPENAI_API_KEY', '').strip()
model = os.getenv('OPENAI_MODEL', 'gpt-5.4-mini').strip()
effort = os.getenv('OPENAI_REASONING_EFFORT', 'low').strip()
print(f'OpenAI 모델: {model}')
print('API 키:', '설정됨 (값은 표시하지 않음)' if key else '미설정')
if not key:
    print('조치: .env 파일에 OPENAI_API_KEY를 등록하고 서버를 재시작하세요.')
    sys.exit(2)
headers = {'Authorization': 'Bearer ' + key}
try:
    with httpx.Client(timeout=httpx.Timeout(30, connect=8)) as c:
        print('1/2 모델 접근 확인 중...')
        r = c.get(f'https://api.openai.com/v1/models/{model}', headers=headers)
        print('모델 조회:', r.status_code)
        if r.status_code != 200:
            print('서버 오류 요약:', r.text[:450].replace('\n', ' '))
            print('조치: 모델 이름, API 키, 계정의 모델 접근/할당량을 확인하세요.')
            sys.exit(1)
        print('2/2 짧은 실제 응답 테스트 중...')
        body = {'model': model, 'messages': [{'role': 'user', 'content': '한 단어로 답해주세요: 연결 확인'}]}
        if effort: body['reasoning_effort'] = effort
        r = c.post('https://api.openai.com/v1/chat/completions', headers=headers, json=body)
        print('생성 응답:', r.status_code)
        if r.status_code == 200:
            print('실제 OpenAI API 호출 성공')
        else:
            print('오류 요약:', r.text[:450].replace('\n', ' '))
            sys.exit(1)
except httpx.TimeoutException:
    print('시간 초과: 네트워크 또는 OpenAI 응답 지연. VPN/방화벽/프록시 및 다른 연결에서 다시 확인하세요.')
    sys.exit(1)
except httpx.RequestError as ex:
    print('연결 오류:', type(ex).__name__)
    print('조치: DNS, VPN/프록시, 학교·회사 네트워크 방화벽 등을 확인하세요.')
    sys.exit(1)
