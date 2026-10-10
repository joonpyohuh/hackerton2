import { z } from "zod";

/**
 * 클라이언트·서버 공용 계약. Mock과 실제 파이프라인(03단계~)이 같은 스키마를 따른다.
 * 스트림 형식: NDJSON — 한 줄에 AgentEvent 하나.
 */

export const agentRequestSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "질문을 입력하세요.")
    .max(500, "질문은 500자 이내로 입력하세요."),
});
export type AgentRequest = z.infer<typeof agentRequestSchema>;

export const runningStageSchema = z.enum([
  "retrieving",
  "generating",
  "structural",
  "semantic",
  "executing",
  "correcting",
]);
export type RunningStage = z.infer<typeof runningStageSchema>;

export const checkResultSchema = z.object({
  status: z.enum(["passed", "failed", "skipped"]),
  errors: z.array(z.string()),
  score: z.number().min(0).max(100).nullable(), // 의미 검증에서만 사용
  durationMs: z.number().nonnegative(),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

export const attemptSchema = z.object({
  index: z.number().int().min(0),
  sql: z.string().nullable(),
  structural: checkResultSchema,
  semantic: checkResultSchema,
  execution: checkResultSchema,
  feedback: z.array(z.string()), // 다음 생성에 전달한 오류 요약
});
export type Attempt = z.infer<typeof attemptSchema>;

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type Cell = z.infer<typeof cellSchema>;

export const resultTableSchema = z.object({
  columns: z.array(
    z.object({
      key: z.string(), // 실제 DB 컬럼명 (번역하지 않음)
      label: z.string(), // 화면 표시용 한국어 이름
      kind: z.enum(["text", "number", "date", "percent"]),
    }),
  ),
  rows: z.array(z.record(z.string(), cellSchema)),
  rowCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type ResultTable = z.infer<typeof resultTableSchema>;

/** 의미 검증 통과와 별개인 "실제 정답" 확인 상태 */
export const groundTruthSchema = z.enum(["unverified", "gold_verified", "human_approved"]);
export type GroundTruth = z.infer<typeof groundTruthSchema>;

const responseBase = {
  requestId: z.string(),
  question: z.string(),
  attempts: z.array(attemptSchema),
  isMock: z.boolean(),
  durationMs: z.number().nonnegative(),
};

export const agentResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("passed"),
    ...responseBase,
    answer: z.string(),
    sql: z.string(),
    table: resultTableSchema,
    meta: z.object({
      metrics: z.array(z.string()),
      period: z.string().nullable(),
      sources: z.array(z.string()),
      assumptions: z.array(z.string()), // 생성 모델이 밝힌 가정 — 숨기지 않고 표시
      semanticScore: z.number().min(0).max(100),
      groundTruth: groundTruthSchema,
    }),
  }),
  z.object({
    status: z.literal("needs_clarification"),
    ...responseBase,
    clarificationQuestion: z.string(),
    missingDefinitions: z.array(z.string()),
  }),
  z.object({
    status: z.literal("failed"),
    ...responseBase,
    message: z.string(),
    reasons: z.array(z.string()),
  }),
]);
export type AgentResponse = z.infer<typeof agentResponseSchema>;
export type FinalStatus = AgentResponse["status"];

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stage"), stage: runningStageSchema, attempt: z.number().int().min(0) }),
  z.object({ type: z.literal("attempt"), attempt: attemptSchema }),
  z.object({ type: z.literal("final"), response: agentResponseSchema }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
