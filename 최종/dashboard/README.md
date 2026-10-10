# OTT Pulse — 2026 아주대학교 OTT 해커톤 대시보드 + GPT 백엔드

원본 `index.html`, `app.js`, `data.js`, `build_data.py`를 기반으로 구성했습니다. 마케팅 KPI, 가입일·기기·연령·성별·푸시 필터, T1/T2/T3, 세그먼트/차트 코드를 보존했습니다. FastAPI + SQLite SQL 분석, 고객 추출·CSV, GPT 전략 생성·채팅 및 추천 저장을 추가했습니다.

## 1. 바로 실행하기 (Windows PowerShell)

```powershell
cd dashboard
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

`.env`를 열어 `ADMIN_TOKEN`을 길고 무작위인 문자열로 바꿉니다. OpenAI API 키를 `OPENAI_API_KEY`에 넣으세요. **키가 없으면 KPI/SQL/CSV/연관 그래프는 동작하고 GPT 생성·채팅·팩트 분석만 503 오류로 중단됩니다.** 기본 모델은 `gpt-5.4-mini`이며 `OPENAI_MODEL`로 바꿀 수 있습니다(gpt-4.x 계열로 바꾸면 `OPENAI_REASONING_EFFORT`를 비우세요). 연결 진단: `python check_openai.py`.

`.env` 자동 로딩을 위해 다음 중 하나를 실행하세요:

```powershell
# uvicorn이 .env 파일을 읽도록 실행 (권장)
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

브라우저에서 **http://127.0.0.1:8000** 에 접속하세요. `index.html`을 파일 탐색기에서 더블클릭하면 API가 연결되지 않습니다. 첫 실행 시 `data.js` 50,000명 데이터가 `runtime/ott_pulse.sqlite3`의 SQL 스냅샷으로 초기 적재됩니다.

기존 화면의 T1/T2/T3 카드에 **✦ GPT 전략** 버튼이 추가되었고, 오른쪽 아래에 **GPT 마케팅 AI** 버튼이 있습니다. AI 패널에 `.env`의 `ADMIN_TOKEN`을 입력하고 타깃을 선택한 뒤 전략 생성 / 질문 / SQL 확인 / 저장 이력 보기를 사용할 수 있습니다. 타깃 CSV는 이제 브라우저 내 파일 생성이 아니라 **보호된 서버 SQL 조회**로 만들어집니다.

## 2. 데이터 변경 및 스냅샷

기존 `build_data.py`에 CSV 7개를 담은 디렉터리 경로를 전달해 `data.js`를 다시 생성합니다.

```powershell
python build_data.py "C:\path\to\csv_folder"
python -m backend.import_snapshot
```

웹에서 AI 패널 **서버 data.js 재적재**를 누르면 현재 서버의 `data.js`를 읽어 재계산된 SQL 스냅샷을 저장합니다. 값이 이전과 동일하면 중복 저장하지 않습니다. 새 데이터가 있으면 **웹 페이지 새로고침**으로 최신 `data.js`도 반영합니다. `GET /api/snapshots`는 이전 버전들을 반환합니다. **외부 데이터가 자동으로 수집되는 시스템은 아닙니다.** 실시간 운영을 위해서는 수집/업로드 파이프라인과 인증이 별도로 필요합니다.

중요: `build_data.py`의 기존 분석 기준(첫 결제 D0~30, D0~30 행동, 시청 D0~60, D+22~28 유지)을 따릅니다. 타깃별 조건은 `backend/analysis.py` SQL에서 관리합니다. `T3`는 결과가 확인된 **D+29 이후** 재활성화 캠페인용입니다. 사전 이탈 예측으로 해석하면 안 됩니다.

## 3. API

| 경로 | 설명 | 권한 |
|---|---|---|
| `GET /api/health` | 활성 스냅샷, GPT 설정 여부 | 공개 집계 |
| `GET /api/overview?...` | 전체 KPI, SQL 타깃 요약 | 공개 집계 |
| `GET /api/targets?...` | T1/T2/T3 고객 수·푸시 도달 | 공개 집계 |
| `GET /api/targets/T1/sql?...` | 현재 필터가 반영된 파라미터 SQL | 공개 메타 |
| `GET /api/targets/T1/customers?...` | 페이지네이션 고객 목록 | ADMIN_TOKEN |
| `GET /api/targets/T1/export?...` | SQL 고객 CSV 다운로드 | ADMIN_TOKEN |
| `POST /api/ai/strategy` | 실시간 GPT 호출 + 전략 자동 저장 | ADMIN_TOKEN + GPT 키 |
| `POST /api/ai/chat` | 선택 타깃 SQL 요약을 포함한 대화 | ADMIN_TOKEN + GPT 키 |
| `GET /api/recommendations` | SQLite에 저장된 전략 이력 | ADMIN_TOKEN |
| `POST /api/snapshots/refresh` | 변경된 서버 data.js를 SQL에 반영 | ADMIN_TOKEN |

필터 파라미터: `from_date`, `to_date`(YYYY-MM-DD), `dev`,`age`,`gen`,`push`는 현재 `app.js`의 옵션 인덱스와 동일합니다(전체=`all`). 미인증 고객 추출은 401이고, 서버 `ADMIN_TOKEN` 자체가 없으면 보호된 API가 503을 반환합니다.

## 4. API 키 및 배포 보안

- GPT API 키를 프론트엔드에 넣지 마세요. 서버의 환경변수로만 주입합니다.
- `.env`, SQLite, backend 소스를 웹 정적 리소스로 제공하지 않습니다. `app.js`,`ai.js`,`data.js`만 명시적으로 제공합니다.
- **주의:** 원본 `data.js`에 50,000명의 비식별 user_key와 고객별 특징이 포함되어 있습니다. **현재 버전은 해커톤 로컬·비공개 시연용**입니다. 공개 AWS URL에서 그대로 제공하면 안 됩니다. 실제 운영 시 브라우저의 고객 단위 데이터를 제거하고 모든 KPI/필터/CSV를 인증된 API로 전환해야 합니다.
- 관리자 토큰은 브라우저 입력창 메모리에만 유지되고 새로고침 시 삭제됩니다. 공유/공개 환경에서는 정식 로그인(OIDC/IAM/Cognito) 및 권한별 분리를 사용하세요.
- GPT 요청에는 고객 키를 전달하지 않고 집계 요약만 전달합니다. 저장된 추천에도 개별 고객 키는 없습니다.
- GPT 연결 실패나 키 미설정 시 **데모 추천을 실제 AI 결과처럼 표시하지 않습니다**.
- Vercel 정적 프로젝트와 다르게 이번 FastAPI 백엔드는 실행 서버가 필요합니다. AWS 배포를 하려면 제공된 Dockerfile을 App Runner/ECS 등에 배포하고 HTTPS, Secrets Manager, 지속적인 SQLite 스토리지(또는 RDS)와 인증을 구성해야 합니다. SQLite 로컬 저장은 컨테이너 교체 시 유실될 수 있으므로 **운영 DB로 바로 사용하지 마세요**.

## 5. 검증

```powershell
pip install pytest
python -m compileall -q backend build_data.py
node --check app.js
node --check ai.js
pytest -q
```

테스트는 KPI·타깃 원본 집계값, 날짜 및 기기 등 복합 필터, SQL 동일 기준 CSV, 인증, 재적재 중복 방지, GPT 키 미설정 오류 및 **GPT 모의 응답의 저장·대화 흐름**을 검증합니다. 실 GPT API 호출은 API 키/네트워크가 있어야 하며 이 패키지 내 자동 테스트에서 라이브 호출하지 않습니다.


## 6. 지표 연관 지도 (`/insights`, React + Tailwind)

`http://127.0.0.1:8000/insights` — 23개 지표(가입 속성·탐색 행동·시청 유형·결제/시청 결과) 사이의 연관을 선으로 보여줍니다.

- **숫자는 전부 서버 계산**(`backend/relations.py`): 지표 쌍마다 2×2 교차표, φ계수, Lift, 조건부 비율 차이(%p), χ² p값. 다중 비교는 본페로니 보정. 상호배타 쌍(같은 기기·연령대 등)은 정의상 연관이라 제외합니다.
- **선 클릭** → 교차표·조건부 비율·통계 근거·해석 한계. 점 클릭 → 그 지표의 연관만 남김. Esc로 해제.
- **뷰 4종**: 네트워크 / 방사형 / 매트릭스 / 순위. 최소 |φ|, 유의성, 결과 지표 연결 필터.
- **AI 팩트 분석**(`POST /api/relations/analyze`, ADMIN_TOKEN 필요): GPT가 서버가 계산한 연관 중 핵심 사실을 고르고, 사실별 시각화 형태(막대·도넛·게이지·도트·모자이크)와 전체 추천 뷰를 정합니다. 서버는 **문장 속 모든 숫자가 원본 값의 반올림인지 대조**하고 **인과·추정 표현(때문, 원인, 영향, 가능성 등)을 차단**해, 통과하지 못한 문장은 폐기하고 폐기 사유를 화면에 보여줍니다.
- 연관은 동시 발생의 정도이며 인과가 아닙니다. 행동(D0~D30)·시청(D0~D60)은 결제 전후 순서를 구분하지 않으므로, 해당 쌍에는 한계가 자동 표기됩니다.

프론트 수정 시:

```powershell
cd web
npm install
npm run dev     # http://localhost:5173/insights/ (API는 8000으로 프록시)
npm run build   # web/dist 생성 → FastAPI가 /insights로 제공
```
