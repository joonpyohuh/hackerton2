# Marketing Intelligence Workspace

토스 스타일의 한국어 업무 화면에서 마케터가 질문하고 데이터 분석가가 계산 근거를 검토하는 OTT 분석 워크스페이스입니다. 기존 NL2SQL·Semantic Resolver·Harness·읽기 전용 PostgreSQL 실행을 유지합니다.

## 협업 워크스페이스

- 추천 키워드·질문은 운영 Semantic Layer와 실제 관측 범위를 읽는 API에서 제공합니다. 후보 지표는 검토 필요로 표시합니다.
- 분석 저장·제목 변경·최근/저장/공유 목록, 내부 공유 링크, CSV 다운로드, 검토 상태와 의견을 지원합니다.
- SQL·시도별 검증 로그·정의 버전은 분석 근거 패널에서 확인합니다. 자동 검증과 분석가 승인은 별도로 표시합니다.
- DB 세션으로 로그인하며 역할은 서버에서 확인합니다. 마케터는 개인/내부 공유 분석과 자신의 수정 제안에 접근하고 분석가는 요청된 분석을 검토합니다.
- 분석가가 승인한 원본 SQL만 동일 Semantic revision과 동일 DB 스키마 지문에서 RAG 사례로 재사용됩니다. 수정 SQL은 제안으로 보관하고 검증 없이 실행하거나 승인하지 않습니다.
- 지표 정의의 과거 버전과 분석별 정의 스냅샷을 보존합니다. 수정 제안은 분석가 승인 후 공식 정의에 반영됩니다.

운영 URL: https://nl2sql-agent-theta.vercel.app/
구현 현황과 마이그레이션 계획: [WORKSPACE_PLAN.md](docs/WORKSPACE_PLAN.md).

`npm run workspace:setup`으로 `004_workspace.sql`을 적용합니다. 초기 분석가 로그인 정보는 Git에서 제외된 `.workspace-owner.local.json`에만 저장됩니다. 구성원 계정은 분석가의 설정 화면에서 발급합니다. 관리자 토큰은 사용하지 않습니다.
협업 운영 확인: `npx tsx scripts/workspace-check.ts` (운영 API에 실제 가입 고객 분석·검토·승인 기록을 남깁니다).

## 시맨틱 정의와 검색

`/semantic`에서 지표·차원·업무·컬럼 용어 118개를 조회하고 질문별 검색 Context를 확인할 수 있습니다. 정의에는 산식, 분자·분모, 집계 단위, 기간, 결측 처리, 원천 테이블과 주의사항이 담깁니다. 질문의 용어 및 별칭으로 관련 정의를 찾고, 해당 테이블 스키마와 담당자가 승인한 유사 SQL 사례를 생성기와 검증기에 전달합니다. 현재 검색은 문자열·별칭 기반이며 벡터 임베딩 검색은 아닙니다.

지표 사전에서 업무 정의를 열람하고 수정안을 제안합니다. 기존 GET /api/semantic 및 질문 검색은 로그인한 구성원이 사용할 수 있으며 POST/PUT/DELETE와 실행 로그 조회는 분석가만 사용할 수 있습니다. 수정 제안과 검토 API는 /api/workspace/definitions입니다. 담당자가 승인한 원본 SQL만 동일 정의 revision과 스키마 버전에서 사례 검색에 재사용됩니다. 정의가 바뀌면 기존 승인 사례는 검색에서 제외됩니다.

캠페인 반응률은 발송·노출과 반응 연결 데이터가 없어 계산을 막았습니다. 평균 시청시간은 원천값 단위가 확인되지 않아 시간이나 분으로 환산하지 않습니다. 이 정의들은 실제 업무 기준과 데이터 사전이 확인되면 관리 화면에서 수정하세요.

## 로컬 실행

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local`에 OpenAI 키, 생성·검증 모델, `DATABASE_URL_READONLY`, `ALLOWED_SCHEMAS`를 설정합니다. 시맨틱 저장소를 준비하려면 관리자 DB URL을 `DATABASE_URL_ADMIN` 또는 `DATABASE_URL_UNPOOLED`로 제공하고 `npm run semantic:setup`을 실행합니다. 이 명령은 `db/migrations/003_semantic.sql`을 적용하고 현재 시드 정의를 적재하며, 제한된 앱 계정의 `DATABASE_URL_APP`을 `.env.local`에 기록합니다. Neon에서는 앱 계정이 연결 풀러 주소를 사용합니다. 재실행하면 앱 계정 비밀번호가 바뀌므로 배포 환경 변수도 갱신해야 합니다. 관리자 DB URL과 `.env.local`은 저장소에 올리지 마세요.

`AGENT_MODE=live`에서 실제 LLM·DB·검색·실행 로그가 작동합니다. `mock`은 화면 확인용 예시 응답입니다.

```bash
npm run typecheck
npm test -- --run src/server/semantic/search.test.ts src/server/agent/retriever.test.ts
npm run build
```
