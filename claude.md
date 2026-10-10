
# NL2SQL Agent — Harness & Loop Engineering

## 1. 프로젝트 목적

본 프로젝트는 Semantic Layer 및 RAG 기반
NL2SQL Agent를 개발하는 해커톤 프로젝트다.

사용자의 자연어 질문을 PostgreSQL SQL로 변환하고,
Harness Engineering 기반의 자동 검증 및
오류 수정 루프를 통해 정확성과 안정성을 높인다.

모든 사용자 대상 결과는 한국어로 제공한다.

### 핵심 개발 원칙

1. 정확성은 생성 속도보다 우선한다.
2. 단 한 번의 LLM 응답을 정답으로 간주하지 않는다.
3. SQL 생성 → 검증 → 실행 → 수정의 루프를 구현한다.
4. 모든 검증 과정과 수정 이력을 기록한다.
5. 검증에 실패한 SQL은 최종 결과로 제공하지 않는다.
6. 검증된 지식을 축적하여 RAG를 개선한다.
7. 데이터에 없는 정보를 추측하거나 생성하지 않는다.
8. SQL 실행과 보안 검사는 코드 및 DB 권한으로 강제한다.
9. 모든 사용자 대상 응답과 분석 결과는 한국어로 출력한다.

---

## 2. 기술 아키텍처

Frontend:
- Next.js
- TypeScript
- Tailwind CSS

Backend:
- Next.js API Routes
- Supabase PostgreSQL
- pgvector

AI Models:
- SQL Generator: GPT-4.1 mini
- SQL Verifier: 환경변수로 지정하는 상위 추론 모델
- 모델 변경이 가능하도록 추상화한다.

Validation:
- Zod
- PostgreSQL 호환 SQL AST Parser
- Read-only PostgreSQL Execution
- Semantic Validation
- Execution Result Validation

---

## 3. Harness Engineering 구조

Harness는 단순한 프롬프트가 아니라
실제로 동작하는 실행 및 검증 시스템이어야 한다.

다음 파이프라인을 구현한다.

사용자 질문
    ↓
질문 의도 분석
    ↓
Semantic Layer 검색
    ↓
RAG Context 검색
    ↓
SQL Generator
    ↓
[Harness Verification Loop 시작]
    ↓
1차: SQL 구조 및 보안 검사
    ↓
2차: LLM 기반 의미 검증
    ↓
3차: 실제 DB 실행 검사
    ↓
검증 결과 판정
    ├── 통과 → 한국어 결과 생성
    ├── 실패 → 오류 원인 분석
    │             ↓
    │          SQL 재생성
    │             ↓
    │          검증 루프 재진입
    └── 정의 불명확 → 사용자에게 한국어로 질문
    ↓
검증 로그 저장
    ↓
승인된 지식만 RAG 반영

---

## 4. Loop Engineering 구현 규칙

### 4.1 자동 검증 루프

SQL 생성 이후 자동으로 검증 루프를 실행한다.

설정:
- MAX_RETRIES = 3
- SEMANTIC_SCORE_THRESHOLD = 90
- 점수 기준은 초기 설정이며 변경 가능해야 한다.
- 반복 횟수와 모델별 호출 비용을 기록한다.
- 무한 반복을 금지한다.

구현 의사코드:

async function runAgent(question) {
  const context = await retrieveContext(question);

  if (context.isAmbiguous) {
    return askClarificationInKorean(context);
  }

  let feedback = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const sql = await generateSQL({
      question,
      context,
      feedback
    });

    const staticCheck = await validateSQL(sql);

    if (!staticCheck.passed) {
      feedback = staticCheck.errors;
      await saveAttemptLog(attempt, sql, feedback);
      continue;
    }

    const semanticCheck = await verifySemantic({
      question,
      sql,
      context
    });

    if (
      !semanticCheck.passed ||
      semanticCheck.score < SEMANTIC_SCORE_THRESHOLD
    ) {
      feedback = semanticCheck.errors;
      await saveAttemptLog(attempt, sql, feedback);
      continue;
    }

    const execution = await executeReadOnlySQL(sql);

    if (!execution.success) {
      feedback = execution.error;
      await saveAttemptLog(attempt, sql, feedback);
      continue;
    }

    await saveSuccessfulLog({
      question,
      sql,
      execution,
      semanticCheck
    });

    return formatKoreanResponse(execution, sql);
  }

  return {
    status: "검증 실패",
    message: "요청한 분석을 안전하게 완료하지 못했습니다.",
    result: null
  };
}

위 코드는 설계를 설명하는 의사코드다.
실제 구현에서는 타입, 타임아웃, 예외 처리,
재시도 가능 여부를 구분하여 구현한다.

검증 실패가 발생하면 오류 내용을 다음 생성에 전달한다.

동일한 오류가 반복되면 무조건 재시도하지 않고
조기 종료할 수 있도록 설계한다.

---

## 5. 1차 검증: SQL Structural Validation

LLM 호출과 무관하게 결정론적 검사를 수행한다.

검증 항목:
1. PostgreSQL 문법 유효성
2. 존재하는 테이블 참조 여부
3. 존재하는 컬럼 참조 여부
4. 테이블 별칭 및 JOIN 관계
5. 허용된 SQL 구문만 사용했는지
6. 위험 구문 및 함수 사용 여부
7. 접근 권한이 없는 데이터 참조 여부
8. 복수 명령문 또는 우회 구문 여부

필수 보안 규칙:
- 조회용 SELECT 쿼리만 허용한다.
- 허용된 읽기 전용 CTE만 지원한다.
- INSERT, UPDATE, DELETE, DROP, ALTER,
  TRUNCATE, CREATE 등 변경 작업을 차단한다.
- AST 기반 허용 목록 방식으로 검사한다.
- 문자열 검색만으로 보안을 판단하지 않는다.
- DB 접속은 전용 읽기 전용 계정을 사용한다.
- SQL 실행에 관리자 또는 service_role 권한을 사용하지 않는다.
- statement_timeout을 설정한다.
- 반환 데이터 행 수를 제한한다.
- 허용 스키마, 테이블, 함수 범위를 제한한다.

어떤 검증이 통과하더라도 DB 권한 검사를
대체할 수 없다.

---

## 6. 2차 검증: LLM Semantic Verification

상위 LLM을 독립적인 SQL 검증기로 사용한다.

검증 모델은 생성 모델이 작성한 SQL을
사용자의 질문과 Semantic Layer 정의를
기준으로 비교하여 평가한다.

검증 항목:
1. 자연어 질문과 SQL의 의미 일치
2. 업무 지표 정의 준수
3. 집계 함수의 적절성
4. JOIN 조건의 정확성
5. WHERE 조건의 정확성
6. 날짜 및 기간 해석의 정확성
7. 분모와 분자의 정의
8. 누락되거나 추가된 필터
9. 사용자 의도와 다른 계산 여부
10. 근거 없는 가정 여부

검증 모델은 반드시 구조화된 JSON으로 응답한다.

예시:

{
  "passed": false,
  "score": 72,
  "errors": [
    "유지율의 분모가 최초 가입자 수로 정의되지 않았습니다.",
    "해지 고객을 집계하는 조건이 누락되었습니다."
  ],
  "suggestions": [
    "Semantic Layer의 유지율 산식을 적용하세요.",
    "해지일 기준 필터를 추가하세요."
  ],
  "missingDefinitions": [],
  "needsClarification": false
}

위 점수는 LLM 의미 검증의 휴리스틱 점수다.
90점 이상이어도 실제 SQL 정답은 보장되지 않는다.

의미 검증 실패 시:
- 오류 원인 기록
- 수정 방향 추출
- Generator에 피드백 전달
- 새 SQL 생성
- 전체 검증 단계 재실행

업무 정의가 누락되었거나 충돌하면
임의로 정의하지 않는다.

명확한 정의가 필요한 경우 재생성 루프 대신
사용자에게 한국어로 уточ? 질문한다.

---

## 7. 3차 검증: SQL Execution Validation

정적 검사 및 의미 검증을 통과한 SQL만
읽기 전용 데이터베이스에서 실행한다.

검증 항목:
- 정상적으로 실행되는가?
- SQL 실행 오류가 발생하는가?
- 데이터 자료형이 적절한가?
- 예상하지 못한 NULL이 발생하는가?
- 결과 행 수가 제한 범위 내에 있는가?
- 집계 결과에 이상한 값이 있는가?
- 비정상적으로 오래 실행되는가?

검증 중 오류가 발생하면 오류 로그를 저장하고
수정 루프로 전달한다.

단, 결과가 0건이라는 이유만으로
잘못된 SQL이라고 단정하지 않는다.

정상 실행되었다는 사실만으로
결과가 의미적으로 정확하다고 판단하지 않는다.

---

## 8. 정답률 평가 시스템

실서비스 검증과 별도의 Benchmark를 구현한다.

평가용 데이터:
- 사용자 질문
- 확정된 업무 지표 정의
- 기준 SQL 또는 기대 결과
- 실제 에이전트 생성 SQL
- 생성 SQL 실행 결과

핵심 평가 지표:

Execution Accuracy =
정답 결과와 일치한 질문 수 / 전체 평가 질문 수

평가 항목:
1. 최초 생성 SQL 정답률
2. 검증 루프 적용 후 최종 정답률
3. SQL 실행 성공률
4. 평균 재시도 횟수
5. 평균 처리 시간
6. 질문당 평균 API 비용
7. 위험 SQL 차단 성공률

LLM의 의미 검증 점수와
실제 정답률을 혼동하지 않는다.

정답이 알려진 Benchmark에서만
객관적인 정답률을 계산한다.

개선에 사용하는 테스트셋과
최종 평가 테스트셋을 분리한다.

실제 측정하지 않은 수치를 출력하지 않는다.

---

## 9. RAG Feedback Loop

검증 과정에서 생성된 지식을 축적한다.

저장할 데이터:
- 원본 사용자 질문
- 검색된 Semantic Context
- 최초 생성 SQL
- 검증 오류
- 수정된 SQL
- 최종 실행 결과
- 검증 상태
- 사용 모델
- 사용한 지표 정의 버전

지식 검증 상태를 구분한다.

1. REJECTED
   검증에 실패한 사례

2. MODEL_VERIFIED
   기술적·의미적 검증을 통과한 사례

3. GOLD_VERIFIED
   기준 SQL 또는 기대 결과와 비교해
   실제 정답이 확인된 사례

4. HUMAN_APPROVED
   권한 있는 담당자가 승인한 사례

RAG의 확정 정답 영역에는
GOLD_VERIFIED 또는 HUMAN_APPROVED만 저장한다.

MODEL_VERIFIED 사례는 로그로 보존하되
자동으로 확정 지식에 등록하지 않는다.

새 지식을 등록할 때 기존 Semantic Layer와
모순되는지 확인한다.

지식 반영 이후 별도 테스트를 수행하여
기존 성능이 악화되지 않았는지 평가한다.

이 구조를 통해 검증된 사례가 축적되도록 한다.

단, RAG 지식 축적을
모델 가중치 학습과 혼동하지 않는다.

---

## 10. 모든 결과 한국어 출력

이 프로젝트의 기본 언어는 한국어다.

아래 항목은 반드시 한국어로 출력한다.

1. 사용자 질문에 대한 최종 답변
2. 데이터 분석 결과 설명
3. SQL 검증 결과
4. 오류 메시지
5. 검증 실패 이유
6. 수정 내역 설명
7. 사용자에게 되묻는 질문
8. 차트 제목 및 축 설명
9. 테이블 컬럼의 화면 표시 이름
10. 대시보드 상태 및 통계 설명

예시:

사용자 질문:
"지난달 광고형 요금제의 유지율을 알려줘."

정상 응답:
"지난달 광고형 요금제의 유지율은 45.4%입니다."

표시할 부가 정보:
- 사용한 지표: 월간 구독 유지율
- 적용 기간: 2026년 9월
- 검증 상태: 통과
- SQL 수정 횟수: 1회
- 데이터 출처: 관련 테이블 및 지표 정의

단, 위 숫자는 출력 형식 예시이며
실제 데이터 분석 결과가 아니다.

개발 규칙:
- SQL 키워드와 실제 DB 컬럼명은 번역하지 않는다.
- DB의 실제 식별자는 원본을 유지한다.
- 사용자에게 표시하는 이름만 한국어로 변환한다.
- API 내부 JSON 필드명은 일관된 영어를 유지해도 된다.
- 자연어 설명과 UI는 한국어를 기본으로 한다.
- 데이터에 존재하지 않는 값은 생성하지 않는다.
- 답변을 만들 수 없다면 이유를 한국어로 설명한다.

---

## 11. Dashboard 및 로그 시각화

사용자가 검증 과정을 확인할 수 있도록
관리자용 검증 대시보드를 구현한다.

표시 항목:
- 최초 생성 SQL
- 최종 수정 SQL
- 검증 단계별 통과 여부
- 반복 검증 횟수
- 오류 발생 원인
- 수정된 부분
- 실행 결과
- 최종 검증 상태
- API 사용량 및 처리 시간

화면의 모든 설명은 한국어로 출력한다.

상태 표시:
- 생성 중
- 구조 검증 중
- 의미 검증 중
- SQL 실행 중
- 오류 수정 중
- 검증 통과
- 검증 실패
- 추가 정보 필요

---

## 12. 테스트 및 완료 기준

다음 상황을 자동 테스트한다.

1. 정상적인 SQL 생성
2. 존재하지 않는 컬럼 생성
3. 잘못된 JOIN 조건
4. 잘못된 집계 기준
5. 정의되지 않은 업무 지표
6. 잘못된 날짜 조건
7. SQL 문법 오류
8. 위험 SQL 생성
9. DB 실행 실패
10. 최대 재시도 횟수 초과
11. 동일 오류 반복
12. RAG에 잘못된 정답 등록 시도
13. 정상적인 데이터 0건 반환
14. 검증 모델의 잘못된 JSON 응답
15. 모든 사용자 대상 출력의 한국어 표시

단위 테스트 및 통합 테스트를 구분한다.

테스트 실패 시 원인을 수정하고 다시 검증한다.

실행하지 않은 테스트를 통과했다고 보고하지 않는다.

---

## 13. 데이터셋 대기 규칙

현재 실제 데이터셋은 아직 제공되지 않았다.

따라서 다음 규칙을 지킨다.

- 실제 데이터셋을 임의로 생성하지 않는다.
- 실제 테이블 구조를 추측하지 않는다.
- 업무 지표 산식을 확정하지 않는다.
- 데이터 의존 기능은 인터페이스로 분리한다.
- 시스템 테스트에는 명시적인 Mock 데이터만 사용한다.
- Mock 데이터는 실제 분석 결과처럼 표시하지 않는다.
- 데이터셋 도착 후 DB Metadata를 추출한다.
- 실제 Semantic Layer를 구축한 뒤 RAG를 연결한다.

현재는 Harness Loop,
검증 모듈, API 및 UI부터 개발한다.

---

## 14. Claude Code 작업 수행 원칙

Claude Code는 위 명세를 기준으로 구현한다.

1. 작업 전에 관련 코드를 확인한다.
2. 기존 기능을 불필요하게 삭제하지 않는다.
3. 작은 단위로 구현하고 테스트한다.
4. 오류 발견 시 원인 분석 후 수정한다.
5. 수정 후 기존 테스트를 재실행한다.
6. 같은 오류를 근거 없이 반복 수정하지 않는다.
7. 테스트 결과와 남은 문제를 명확히 구분한다.
8. 모든 작업 보고를 한국어로 작성한다.

작업 완료 시 다음 형식으로 보고한다.

[구현 완료]
- 구현한 기능

[검증 결과]
- 통과한 테스트
- 실패한 테스트

[수정 사항]
- 발견된 문제와 수정 내용

[남은 과제]
- 추가 구현이 필요한 기능

[다음 단계]
- 권장 개발 순서

최종 목표:
검증 가능한 Semantic Layer 기반
한국어 NL2SQL Agent를 구축한다.
