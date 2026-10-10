import type { CheckResult, FinalStatus, GroundTruth, IssueType, ResolutionStatus, RunningStage } from "./contract";

export const STAGE_STATUS_LABEL: Record<RunningStage, string> = {
  resolving: "지표 해석 중",
  retrieving: "맥락 검색 중",
  generating: "생성 중",
  structural: "구조 검증 중",
  semantic: "의미 검증 중",
  executing: "SQL 실행 중",
  correcting: "오류 수정 중",
};

/** 진행 표시줄에 나열하는 단계 (correcting은 별도 상태로만 표시) */
export const PIPELINE_STEPS: { stage: Exclude<RunningStage, "correcting">; label: string }[] = [
  { stage: "resolving", label: "지표 해석" },
  { stage: "retrieving", label: "맥락 검색" },
  { stage: "generating", label: "SQL 생성" },
  { stage: "structural", label: "구조 검증" },
  { stage: "semantic", label: "의미 검증" },
  { stage: "executing", label: "SQL 실행" },
];

export const FINAL_STATUS_LABEL: Record<FinalStatus, string> = {
  passed: "검증 통과",
  failed: "검증 실패",
  needs_clarification: "추가 정보 필요",
};

export const RESOLUTION_STATUS_LABEL: Record<ResolutionStatus, string> = {
  resolved: "공식 정의로 확정",
  ambiguous: "해석 선택 필요",
  undefined: "공식 정의 없음",
  unavailable: "계산 불가",
  no_metric: "지표 없이 조회",
};

/** 정의 문제(업무 판단 필요)와 기술 오류를 화면에서 구분한다. */
export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  definition_missing: "정의 문제 · 공식·후보 정의 없음",
  definition_ambiguous: "정의 문제 · 계산 기준 선택 필요",
  assumption_needed: "정의 문제 · 미승인 가정 확인 필요",
  data_unavailable: "데이터 문제 · 범위·원천 부족",
  definition_conflict: "정의 문제 · SQL이 정의와 불일치",
  sql_error: "기술 오류 · SQL 구조",
  execution_error: "기술 오류 · DB 실행",
  system_error: "기술 오류 · 시스템",
};

export const GROUND_TRUTH_LABEL: Record<GroundTruth, string> = {
  unverified: "정답 미확인",
  gold_verified: "기준 결과 일치",
  human_approved: "담당자 승인",
};

export const CHECK_STATUS_LABEL: Record<CheckResult["status"], string> = {
  passed: "통과",
  failed: "실패",
  skipped: "미실행",
};
