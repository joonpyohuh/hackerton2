"""Initialize local .env with an automatically generated admin token."""
import secrets
from pathlib import Path
root=Path(__file__).parent
f=root/'.env'
if f.exists():
    print('Existing .env kept unchanged.')
else:
    token=secrets.token_urlsafe(32)
    template=(root/'.env.example').read_text(encoding='utf-8')
    f.write_text(template.replace('replace-with-a-long-random-string',token),encoding='utf-8')
    print('\n=== 최초 실행: .env 생성 완료 ===')
    print('대시보드 AI 패널의 관리자 토큰으로 다음 값을 입력하세요:')
    print(token)
    print('GPT 실제 호출을 위해 .env의 OPENAI_API_KEY에 별도 API 키를 입력하세요.')
