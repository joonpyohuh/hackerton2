import { z } from "zod";

/**
 * 클라이언트·서버 공용 계약. Mock과 실제 파이프라인(03단계~)이 같은 스키마를 따른다.
 * 스트림 형식: NDJSON — 한 줄에 AgentEvent 하나.
 */

const text = (max = 500) => z.string().max(max);
const list = (max = 20, itemMax = 500) => z.array(text(itemMax)).max(max);

/**
 * Semantic Resolver 판정 결과. SQL 생성 전에 "무엇을, 어떤 정의로, 어떤 기간·단위로" 계산할지 확정한다.
 * 클라이언트는 이 값을 다음 질문의 대화 이력으로 되돌려 보낸다 — 서버는 이를 데이터로만 취급하고 다시 검증한다.
 */
export const resolutionStatusSchema = z.enum([
  "resolved", // 공식 정의로 계산 가능
  "ambiguous", // 계산 가능한 해석이 여러 개이거나 승인되지 않은 가정이 필요 — 선택지 제시
  "undefined", // 요구한 지표의 공식 정의가 없음
  "unavailable", // 데이터 범위·원천 부족으로 계산 불가
  "no_metric", // 업무 지표 없이 원천 컬럼 조회로 답할 수 있음
]);
export type ResolutionStatus = z.infer<typeof resolutionStatusSchema>;

export const resolutionOptionSchema = z.object({ label: text(200), metricIds: list(5, 64) });
export type ResolutionOption = z.infer<typeof resolutionOptionSchema>;

/** 질문 속 업무 개념 하나와 그에 대응한 정의. 개념별로 검색해 질문 전체 맥락을 확보했는지 확인한다. */
export const resolutionConceptSchema = z.object({
  phrase: text(100),
  role: z.enum(["metric", "dimension", "filter", "period", "term"]),
  ids: list(5, 64),
});
export type ResolutionConcept = z.infer<typeof resolutionConceptSchema>;

export const resolutionSchema = z.object({
  status: resolutionStatusSchema,
  standaloneQuestion: text(1000), // 이전 대화를 합친 완결 질문
  requestedMetric: text(200).nullable(), // 사용자가 말한 지표 표현
  metricIds: list(5, 64), // 공식 지표·업무 용어 ID
  supportIds: list(10, 64), // 함께 쓰는 차원·용어 ID
  filters: list(10),
  period: text(300).nullable(),
  grain: text(200).nullable(),
  relations: list(10),
  unspecified: list(10), // 사용자가 지정하지 않아 정의 기본값을 쓴 조건
  confirmed: list(10), // 이전 대화에서 사용자가 확정한 조건
  assumptions: list(10), // 사용자가 승인하지 않은 가정
  options: z.array(resolutionOptionSchema).max(5),
  reason: text(1000).nullable(),
  clarificationQuestion: text(1000).nullable(),
  concepts: z.array(resolutionConceptSchema).max(8).default([]),
  candidateIds: list(10, 64).default([]), // 사용한 정의 중 공식이 아닌 후보 정의
});
export type Resolution = z.infer<typeof resolutionSchema>;

export const conversationTurnSchema = z.object({
  question: text(500),
  status: z.enum(["passed", "needs_clarification", "failed"]),
  clarificationQuestion: text(1000).nullable().default(null),
  resolution: resolutionSchema.nullable().default(null),
});
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;
export const MAX_HISTORY_TURNS = 6;

export const agentRequestSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "질문을 입력하세요.")
    .max(500, "질문은 500자 이내로 입력하세요."),
  history: z.array(conversationTurnSchema).max(MAX_HISTORY_TURNS).default([]),
});
export type AgentRequest = z.infer<typeof agentRequestSchema>;

export const runningStageSchema = z.enum([
  "resolving",
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
  resolution: resolutionSchema.optional(),
};

/** 생성 SQL이 실제로 적용한 정의 메타데이터. 정의 준수 검사의 대상이며 화면에 그대로 보여준다. */
export const definitionUsageSchema = z.object({
  metricIds: z.array(z.string()),
  definitionRefs: z.array(z.string()), // "id@v버전"
  formula: z.string(),
  filters: z.array(z.string()),
  grain: z.string().nullable(),
  unapprovedAssumptions: z.array(z.string()),
  candidateIds: z.array(z.string()).default([]), // 적용한 후보(비공식) 정의
});
export type DefinitionUsage = z.infer<typeof definitionUsageSchema>;

/**
 * 보류·실패의 성격. 정의 문제(업무 판단 필요)와 기술 오류(SQL·실행·시스템)를 구분한다.
 * - definition_missing / definition_ambiguous / assumption_needed / data_unavailable: 사용자·담당자 판단이 필요
 * - definition_conflict: SQL이 정의를 따르지 못함(재생성 한도 초과)
 * - sql_error / execution_error / system_error: 기술 오류
 */
export const issueTypeSchema = z.enum([
  "definition_missing",
  "definition_ambiguous",
  "assumption_needed",
  "data_unavailable",
  "definition_conflict",
  "sql_error",
  "execution_error",
  "system_error",
]);
export type IssueType = z.infer<typeof issueTypeSchema>;

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
      definition: definitionUsageSchema.optional(),
    }),
  }),
  z.object({
    status: z.literal("needs_clarification"),
    ...responseBase,
    clarificationQuestion: z.string(),
    missingDefinitions: z.array(z.string()),
    issueType: issueTypeSchema.optional(),
  }),
  z.object({
    status: z.literal("failed"),
    ...responseBase,
    message: z.string(),
    reasons: z.array(z.string()),
    issueType: issueTypeSchema.optional(),
  }),
]);
export type AgentResponse = z.infer<typeof agentResponseSchema>;
export type FinalStatus = AgentResponse["status"];

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stage"), stage: runningStageSchema, attempt: z.number().int().min(0) }),
  z.object({ type: z.literal("resolution"), resolution: resolutionSchema }),
  z.object({
    type: z.literal("context"),
    sources: z.array(z.string()),
    schema: z.string(),
    semantic: z.string(),
    examples: z.string(),
    // score는 검색 관련도(휴리스틱)이며 정답률과 무관하다. via: resolver = 질문 의미 판정으로 선택, lexical = 표현 일치
    matches: z.array(z.object({
      id: z.string(), name: z.string(), kind: z.enum(["metric", "dimension", "term"]), score: z.number(), version: z.number(),
      via: z.enum(["resolver", "lexical"]).optional(),
    })),
    exampleMatches: z.array(z.object({ requestId: z.string(), question: z.string(), score: z.number() })),
    concepts: z.array(z.object({ phrase: z.string(), role: z.string(), ids: z.array(z.string()), synonyms: z.array(z.string()) })).optional(),
  }),
  z.object({ type: z.literal("attempt"), attempt: attemptSchema }),
  z.object({ type: z.literal("final"), response: agentResponseSchema }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
