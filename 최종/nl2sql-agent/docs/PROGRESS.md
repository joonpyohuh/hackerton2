# 진행 상황

규칙: 실제로 실행한 검증만 "통과"로 적는다. 실행하지 않은 항목은 "미실행"으로 남긴다.

| 단계 | 상태 |
|---|---|
| 01 프로젝트 초기화 | 완료 |
| 02 Chat UI | 완료 (Mock) |
| 03 Agent Pipeline | 완료 (fake 의존성으로 검증) |
| 04 Harness Engine | 완료 (구조 검사기·의미 검증기) |
| 05 Database & Metadata | 완료 (로컬 PostgreSQL) — Supabase 적용 대기 |
| 06 Semantic Layer | 대기 — 지표 정의 확정 필요 |
| 07 RAG | 대기 |
| 08 NL2SQL 통합 | 연결 완료 — OPENAI_API_KEY·VERIFIER_MODEL 설정 후 실호출 검증 |
| 09 Verified Feedback | 대기 |
| 10 Evaluation Dashboard | 대기 — 기존 OTT Pulse 대시보드 통합 예정 |

---

## 01 프로젝트 초기화 — 2026-10-10

구현
- Next.js 16.4 (App Router, `src/`), TypeScript strict, Tailwind v4, ESLint
- 의존성: openai, zod 4, pg, server-only / 개발: vitest, @types/pg
- `src/server/config/env.schema.ts` — Zod 환경변수 스키마. 모델·재시도·임계값·DB 설정 교체 가능
  - `VERIFIER_MODEL`은 기본값 없음. 미설정 시 의미 검증 단계 차단
  - `DATABASE_URL_READONLY`에 `postgres`/`postgres.<ref>`/`service_role` 계정을 쓰면 거부
  - `ALLOWED_SCHEMAS` 비어 있으면 실행 불가 (fail-closed)
- `src/server/config/env.ts` — `server-only`로 클라이언트 번들 유입 차단
- `GET /api/health` — 비밀값 없이 설정 상태, 기능별 누락 항목 반환
- `prompts/` — 런타임 프롬프트 v0 초안 (CLAUDE.md와 분리)

결정 사항
- SQL 실행(`DATABASE_URL_READONLY`)과 로그·RAG 저장(`DATABASE_URL_APP`)의 DB 계정을 분리
- SQL AST parser 선택은 04단계로 미룸 (PostgreSQL 실제 파서 기반 후보 비교 후 결정)
- 설치 중 이슈: vitest 5가 `@types/node` 22 이상 요구 → `^24`로 상향 (로컬 Node v24.14)

검증 (2026-10-10 실제 실행)
- `npm run typecheck` 통과 / `npm run lint` 통과 / `npm run build` 통과
- `npm test` 10/10 통과 (env 스키마: 기본값, 교체, 범위 거부, 관리자 URL 거부, readiness)
- `next start` 후 `GET /api/health` 호출: mock 모드, 기능별 누락 항목 반환 확인
- 관리자 계정 URL(`postgres.<ref>`)로 기동 시 `ok:false` + 한국어 오류 반환 확인

빌드 중 수정
- Next 16 템플릿의 `cacheComponents: true`와 `export const dynamic` 충돌 → `await connection()`으로 교체
- `LayoutProps`는 Next 생성 타입 → `typecheck` 스크립트에 `next typegen` 선행

TODO
- 05단계: Supabase에 읽기 전용 role 생성 SQL (권한은 DB에서 강제)
- 대시보드(`../dashboard`, FastAPI + SQLite) 통합 방식 결정 — 10단계 전

---

## 02 Chat UI — 2026-10-10

구현
- `src/lib/agent/contract.ts` — 요청·스트림 이벤트·최종 응답 Zod 계약 (03단계 파이프라인도 동일 계약 사용)
  - 최종 상태: `passed` / `needs_clarification` / `failed`
  - `semanticScore`(의미 검증)와 `groundTruth`(unverified / gold_verified / human_approved)를 별도 필드로 분리
- `POST /api/agent` — NDJSON 스트림(`stage` → `attempt` → `final`). 클라이언트 연결 종료 시 중단. live 모드는 501
- `src/server/mock/mockAgent.ts` — 가상 상점 테이블(`mock_*`) 기반 3개 시나리오. 실제 스키마와 무관, `isMock=true`
  - 재시도 후 통과 / 정의 불명확 → 확인 질문 / 동일 오류 2회 → 조기 종료
- UI: 12단 그리드(라벨 3 / 본문 9), Pretendard + Geist Mono, 무채색 4단 + 강조색 1개
  - 질문 → 진행(5단계 트랙) → 답변·메타 → 결과 표 → 최종 SQL → 검증 로그(시도별 구조/의미/실행)
  - 한글 IME 조합 중 Enter 무시, 요청 취소, 스트림 계약 위반 시 오류 표시

검증 (실제 실행)
- `npm test` 16/16 통과 (Mock 이벤트 전부 계약 통과, 청크 분할 NDJSON 복원 포함)
- typecheck / lint / build 통과
- 브라우저에서 3개 시나리오 실행: 진행 중 "구조 검증 중" 표시 → 최종 화면 확인

TODO
- 03단계: `runMockAgent`와 동일 시그니처의 실제 파이프라인 연결
- 대화 맥락(이전 질문 참조)은 미지원 — 질문 단위 독립 처리

---

## 03 Agent Pipeline — 2026-10-10

구현 (`src/server/agent/`)
- `types.ts` — 단계 인터페이스: ContextRetriever / SqlGenerator / StructuralValidator / SemanticVerifier / QueryExecutor / ResultFormatter / RunLogger
- `pipeline.ts` — `runAgentPipeline`: 생성 → 구조 → 의미 → 실행, 실패 시 오류를 피드백으로 재생성
  - 재시도 상한 `MAX_RETRIES` (총 시도 = 상한 + 1), 의미 점수 기준 `SEMANTIC_SCORE_THRESHOLD` (passed=true여도 미달이면 실패)
  - 동일 오류 `REPEATED_ERROR_LIMIT`회 연속 → 조기 종료 (`repeatTracker.ts`, 숫자 차이는 같은 오류로 간주)
  - 정의 누락·모호 → 재생성하지 않고 확인 질문
  - `errors.ts` — 단계별 타임아웃 + 취소, `StageError.retryable`로 재시도 가능 여부 구분 (인증 오류 등은 즉시 종료)
  - 검증기 형식 오류·타임아웃은 SQL 탓이 아니므로 생성 피드백에 넣지 않음
  - 결과 0건은 실패가 아님
- 로그: `RunLog` (질문, 맥락 출처, 정의 버전, 최초/최종 SQL, 시도별 검증 결과, 실패 사유, 단계별 토큰 사용량, 모델)
  - 런타임 상태 타입은 `REJECTED | MODEL_VERIFIED`만 허용 → GOLD/HUMAN 등록 경로가 타입상 존재하지 않음
  - 로그 저장 실패는 응답을 막지 않고 서버 콘솔에 오류 기록
- `live.ts` — 실제 구현체 조립. 미완성 항목이 있으면 실행 거부 (`/api/agent` live 모드 → 501 + 한국어 목록)

검증 (실제 실행)
- `npm test` 30/30 통과 — 파이프라인 14개 시나리오 (CLAUDE.md §12의 1·2·3·4·5·6·7·9·10·11·13·14 + 재시도 불가 오류·타임아웃·취소·로그 실패)
- typecheck / lint / build 통과
- live 모드 서버 기동 → `POST /api/agent` 501 + 미완성 항목 목록 확인
- mock 모드 UI 동작 회귀 확인

결정·한계
- 로그는 실행 종료 시 1회 저장 (시도별 즉시 저장은 09단계 DB 로거에서 검토)
- 결과 설명(Formatter) 실패 시 검증된 결과도 실패 처리 — 08단계에서 템플릿 폴백 검토
- §12의 8(위험 SQL)·12(RAG 오등록)·15(한국어 출력)는 각각 04·09·08단계 구현체 테스트에서 다룸

---

## 04 Harness Engine — 2026-10-10

구현
- **1차 구조 검사** `src/server/harness/structural/`
  - 파서: `libpg-query` 18 (PostgreSQL 실제 파서의 WASM 빌드). pgsql-ast-parser·node-sql-parser는 PG 문법을 근사하므로 보안 용도에서 제외
  - 허용 목록(deny-by-default): AST 노드 31종, 함수 약 90종(스키마 미지정 또는 `pg_catalog`만). 노드 목록은 분석 샘플 쿼리를 실제 파싱해 추출
  - 단일 `SelectStmt`만 허용. `intoClause`(SELECT INTO)는 래퍼 노드가 없어 별도 검사
  - 허용 스키마·테이블·컬럼을 `SchemaCatalog`와 대조 (파생 테이블·CTE 출처 컬럼은 실행 단계에서 확인)
  - 행 수 제한은 실행기(05단계)가 강제
- **2차 의미 검증** `src/server/harness/semanticVerifier.ts`
  - `prompts/sql-verifier.v0.md` 로드 → `VERIFIER_MODEL` 호출(JSON 모드) → Zod 검증
  - 형식 오류는 재시도 가능 `invalid_response`, 모순 응답(passed=true + 오류)은 실패 처리
  - 프롬프트 인젝션 대응: 질문·SQL을 태그로 감싸고 데이터로만 취급하도록 명시
- **LLM 공용** `src/server/llm/` — `ChatClient` 추상화(테스트 교체용), OpenAI 오류 → 재시도 가능 여부 매핑(401/403/400/404 불가, 429/5xx/연결 가능), SDK 자체 재시도 끔
- 사용량 로그에 `promptVersion` 추가
- `/api/health`에 `sqlParser` 상태 추가

검증 (실제 실행)
- `npm test` 87/87 통과
  - 구조: 허용 8종, 위험 SQL 차단 22종(§12-8: DML/DDL, 다중 문장, 데이터 변경 CTE, SELECT INTO, FOR UPDATE, EXPLAIN ANALYZE, pg_sleep, 파일 읽기, set_config, 시스템 카탈로그 등), 참조 오류 6종(§12-2·7)
  - 의미: 정상 판정, 모순 응답, 잘못된 응답 4종(§12-14), 오류 매핑 9종, 실제 프롬프트 파일 렌더링
- typecheck / lint / build 통과
- `next start` 후 `/api/health` → `sqlParser: ok`

발견·수정
- Next(Turbopack) 번들링 시 libpg-query WASM 경로가 `C:\ROOT\...`로 깨짐 (vitest에서는 재현 안 됨) → `serverExternalPackages: ["libpg-query"]`
- vitest 설정을 `.mts`로 변경 (ESM 경고 제거)

한계
- 실제 OpenAI 호출은 미실행 (API 키·VERIFIER_MODEL 미설정). 어댑터는 fake ChatClient로만 검증
- 비한정 컬럼은 파생 테이블이 있으면 검사를 생략 — DB 실행 단계와 읽기 전용 권한이 최종 방어선

---

## 05 Database & Metadata + 08 NL2SQL 연결 — 2026-10-10

사용자 요청(실제 분석 결과, 자유 질문)으로 05·08단계 핵심을 함께 진행. 06(지표 정의)·07(RAG)은 인터페이스만 유지.

구현
- `db/migrations/001_analytics_raw.sql` — CSV 7개 원본 그대로 `analytics` 스키마 (타입·PK·FK는 프로파일링 기준, 선행 0 문자열 보존)
- `db/migrations/002_readonly_role.sql` — `nl2sql_reader`: analytics SELECT만, `default_transaction_read_only`, `statement_timeout 5s`, `search_path=analytics`
- `scripts/db-local.ts` — 로컬 PostgreSQL 18 (embedded-postgres 바이너리를 `~/.nl2sql-agent/pgbin`에 복사해 실행)
  - 원인 확인: 한글 경로에서 Windows initdb가 `invalid byte sequence for encoding "UTF8": 0xbf`로 실패 → 영문 경로에서 재현 시 정상
- `scripts/db-setup.ts` — 스키마 → COPY 적재(행 수 대조) → 읽기 전용 계정(무작위 비밀번호) → 권한 자체 검증. 로컬·Supabase 공용, 멱등
- `src/server/db/executor.ts` — `BEGIN READ ONLY` + `SET LOCAL statement_timeout` + 커서 `FETCH max+1`로 행 수 제한, 항상 ROLLBACK. SQLSTATE별 재시도 구분
- `src/server/db/metadata.ts` — information_schema·pg_constraint에서 테이블·컬럼·PK/FK·행 수 추출 → 구조 검사 카탈로그 + 프롬프트 스키마 설명 (10분 캐시)
- `src/server/semantic/dataNotes.ts` — 프로파일링으로 검증한 데이터 특성만 기록. 의미 미확인 코드값은 "미확인"으로 명시
- `generator.ts`(GPT-4.1 mini, `sql-generator.v0`), `retriever.ts`(구조 + 데이터 특성), `formatter.ts`(결정론적 — 답변 숫자는 실행 결과에서만)
- UI: 서버 `AGENT_MODE`에 따라 헤더·예시 질문 전환, 생성 모델의 가정을 "적용한 가정"으로 표시
- Vercel 대비: `outputFileTracingIncludes`(프롬프트·WASM), `/api/agent` `maxDuration = 300`

검증 (실제 실행)
- 로컬 적재: 7개 테이블 행 수 CSV와 일치 (user_dim 50,000 / behavior_fact 457,630 / payment_fact 14,388 / watch_daily_fact 248,522 / user_content_summary 174,675 / content_dim 13,532 / content_genre_bridge 41,203)
- 읽기 전용 계정: 조회 가능, INSERT·CREATE TABLE·public 쓰기·READ WRITE 전환 후 DELETE 모두 차단
- `npm test` 94/94 — DB 통합 7개 포함 (메타데이터, 실제 카탈로그 구조 검사, 타입 보존, 행 수 제한·정렬 유지, 시간 초과, DB 오류, 파이프라인 전체: 기기별 가입자 수가 프로파일링 값과 일치)
- typecheck / lint / build 통과, live 화면 확인, `/api/agent` → 501 (남은 항목: OPENAI_API_KEY, VERIFIER_MODEL)

미실행
- 실제 OpenAI 호출 (키 미설정)
- Supabase 적용, Vercel 배포 (계정 필요)

---

## Semantic Resolver · 대화 상태 · 정의 준수 검사 — 2026-10-10

구현
- `src/server/semantic/resolver.ts` + `prompts/semantic-resolver.v0.md` — SQL 생성 전 지표·기간·집계 단위·필터·확정 조건 판정.
  LLM은 카탈로그 ID를 제안만 하고, `finalizeResolution`이 존재·상태(needs_data)·데이터 범위(`DATA_COVERAGE`)·미승인 가정을 결정론적으로 재판정
- 대화 상태: 요청 `history`(최근 6턴, 판정 결과 포함) → Resolver가 완결 질문(`standaloneQuestion`)으로 합침. 화면에 선택지 버튼·새 대화
- `src/server/harness/definitionCheck.ts` — 정의 준수 검사(지표 ID 일치, 필수 테이블, 정의 산식의 리터럴 조건, 계산식 누락, 생성 모델이 밝힌 미승인 가정)
- 생성 v1·검증 v1 프롬프트 — 생성 메타데이터(metricIds·formula·filters·grain·unapprovedAssumptions), 검증 모델의 definitionMatch·grainMatch·unapprovedAssumptions.
  점수 ≥ 기준이어도 셋 중 하나라도 위반이면 실패
- 검색: Resolver가 의미로 고른 정의 우선, 다른 metric은 표현 일치만으로 넣지 않음, 컬럼 사전은 컬럼명이 질문에 있을 때만

검증 (실제 실행)
- `npm test` 128 통과 (db.test.ts는 로컬 PostgreSQL 미기동으로 실패 — 기존과 동일)
- typecheck / lint / build 통과, Mock 모드 화면에서 선택지 버튼 → history 전송 확인

미실행
- 실제 OpenAI 호출로 6개 회귀 질문 수정 후 응답 확인 (로컬에 OPENAI_API_KEY 없음, 운영 배포 필요)
