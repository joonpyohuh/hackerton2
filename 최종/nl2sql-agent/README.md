# NL2SQL Agent

OTT 고객 분석 질문을 PostgreSQL SQL로 바꾸고, 구조 검사 → 의미 검사 → 읽기 전용 실행을 통과한 결과만 표시합니다. 실패하면 검사 오류를 다음 생성 시도에 전달합니다.

## 시맨틱 정의와 검색

`/semantic`에서 지표·차원·업무 용어 23개를 조회하고 질문별 검색 Context를 확인할 수 있습니다. 정의에는 산식, 분자·분모, 집계 단위, 기간, 결측 처리, 원천 테이블과 주의사항이 담깁니다. 질문의 용어 및 별칭으로 관련 정의를 찾고, 해당 테이블 스키마와 담당자가 승인한 유사 SQL 사례를 생성기와 검증기에 전달합니다. 현재 검색은 문자열·별칭 기반이며 벡터 임베딩 검색은 아닙니다.

정의 검색 화면에서 질문별 시맨틱 Context를 조회하고, 정의 생성·수정·삭제와 실행 기록 검토·승인을 바로 사용할 수 있습니다. API는 `GET /api/semantic`, `GET /api/semantic?question=...`, `POST/PUT/DELETE /api/semantic`, `GET/PATCH /api/semantic/runs`입니다. 통과한 실행도 자동으로 정답으로 등록되지 않습니다. 담당자 승인 후 같은 정의 revision에서만 사례 검색에 재사용됩니다. 정의가 바뀌면 기존 승인 사례는 검색에서 제외되며 새 기준으로 검토해야 합니다.

캠페인 반응률은 발송·노출과 반응 연결 데이터가 없어 계산을 막았습니다. 평균 시청시간은 원천값 단위가 확인되지 않아 시간이나 분으로 환산하지 않습니다. 이 정의들은 실제 업무 기준과 데이터 사전이 확인되면 관리 화면에서 수정하세요.

## 로컬 실행

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local`에 OpenAI 키, 생성·검증 모델, `DATABASE_URL_READONLY`, `ALLOWED_SCHEMAS`를 설정합니다. 시맨틱 저장소를 준비하려면 관리자 DB URL을 `DATABASE_URL_ADMIN` 또는 `DATABASE_URL_UNPOOLED`로 제공하고 `npm run semantic:setup`을 실행합니다. 이 명령은 `db/migrations/003_semantic.sql`을 적용하고 초기 정의 23개를 적재하며, 제한된 앱 계정의 `DATABASE_URL_APP`을 `.env.local`에 기록합니다. Neon에서는 앱 계정이 연결 풀러 주소를 사용합니다. 재실행하면 앱 계정 비밀번호가 바뀌므로 배포 환경 변수도 갱신해야 합니다. 관리자 DB URL과 `.env.local`은 저장소에 올리지 마세요.

`AGENT_MODE=live`에서 실제 LLM·DB·검색·실행 로그가 작동합니다. `mock`은 화면 확인용 예시 응답입니다.

```bash
npm run typecheck
npm test -- --run src/server/semantic/search.test.ts src/server/agent/retriever.test.ts
npm run build
```
