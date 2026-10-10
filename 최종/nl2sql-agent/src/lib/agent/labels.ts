import type { CheckResult, FinalStatus, GroundTruth, RunningStage } from "./contract";

export const STAGE_STATUS_LABEL: Record<RunningStage, string> = {
  retrieving: "맥락 검색 중",
  generating: "생성 중",
  structural: "구조 검증 중",
  semantic: "의미 검증 중",
  executing: "SQL 실행 중",
  correcting: "오류 수정 중",
};

/** 진행 표시줄에 나열하는 단계 (correcting은 별도 상태로만 표시) */
export const PIPELINE_STEPS: { stage: Exclude<RunningStage, "correcting">; label: string }[] = [
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
