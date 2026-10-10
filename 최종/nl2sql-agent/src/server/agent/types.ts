import type { Attempt, Cell, FinalStatus, ResultTable } from "@/lib/agent/contract";

/**
 * 파이프라인 단계 인터페이스. 데이터 의존 구현체는 각 단계에서 작성한다.
 * 모든 비동기 단계는 signal을 받아 취소·타임아웃을 존중해야 한다.
 */

export type LlmUsage = {
  stage: "generation" | "verification" | "formatting";
  model: string;
  promptVersion: string | null; // 예: "sql-verifier.v0" — 프롬프트 변경 전후 비교용
  inputTokens: number;
  outputTokens: number;
};

// ── Semantic Layer + 질문별 검색 ──
export type RetrievedContext = {
  schemaContext: string;
  semanticContext: string;
  examples: string; // 담당자 승인 사례만
  isAmbiguous: boolean;
  clarificationQuestion: string | null;
  missingDefinitions: string[];
  definitionVersion: string | null;
  sources: string[];
  matches?: { id: string; name: string; kind: "metric" | "dimension" | "term"; score: number; version: number }[];
  exampleMatches?: { requestId: string; question: string; score: number }[];
};
export interface ContextRetriever {
  retrieve(question: string, signal: AbortSignal): Promise<RetrievedContext>;
}

// ── 08단계: SQL Generator ──
export type GenerationInput = { question: string; context: RetrievedContext; feedback: string[]; attempt: number };
export type GenerationOutput = {
  sql: string | null;
  title: string; // 결과를 한 줄로 설명하는 한국어 제목 (숫자 없이)
  period: string | null; // 적용 기간 (한국어)
  columnLabels: Record<string, string>; // 결과 컬럼명 → 한국어 표시명
  explanation: string;
  usedMetrics: string[];
  assumptions: string[];
  needsClarification: boolean;
  clarificationQuestion: string | null;
  usage: LlmUsage;
};
export interface SqlGenerator {
  generate(input: GenerationInput, signal: AbortSignal): Promise<GenerationOutput>;
}

// ── 04단계: 1차 구조·보안 검사 (결정론적) ──
export type StructuralResult = {
  passed: boolean;
  errors: string[];
  normalizedSql: string | null; // 행 수 제한 등을 적용한 실행용 SQL
};
export interface StructuralValidator {
  validate(sql: string): Promise<StructuralResult>;
}

// ── 04단계: 2차 의미 검증 (상위 LLM) ──
export type SemanticVerdict = {
  passed: boolean;
  score: number;
  errors: string[];
  suggestions: string[];
  missingDefinitions: string[];
  needsClarification: boolean;
  usage: LlmUsage;
};
export interface SemanticVerifier {
  verify(input: { question: string; sql: string; context: RetrievedContext }, signal: AbortSignal): Promise<SemanticVerdict>;
}

// ── 05단계: 3차 읽기 전용 실행 ──
export type ExecutionOutput = {
  columns: { name: string; dataType: string }[];
  rows: Record<string, Cell>[];
  rowCount: number;
  truncated: boolean;
};
export interface QueryExecutor {
  /** 실패 시 StageError("execution", ..., retryable)를 던진다. */
  execute(sql: string, signal: AbortSignal): Promise<ExecutionOutput>;
}

// ── 08단계: 한국어 결과 생성 ──
export type FormattedResult = {
  answer: string;
  table: ResultTable;
  metrics: string[];
  period: string | null;
  assumptions: string[];
  usage: LlmUsage | null; // 템플릿 방식이면 null
};
export interface ResultFormatter {
  format(
    input: { question: string; sql: string; context: RetrievedContext; execution: ExecutionOutput; generation: GenerationOutput },
    signal: AbortSignal,
  ): Promise<FormattedResult>;
}

// ── 실행 로그 ──
/** 런타임 파이프라인이 부여할 수 있는 상태는 둘뿐이다. GOLD/HUMAN은 벤치마크·승인 절차에서만 부여한다. */
export type RuntimeKnowledgeStatus = "REJECTED" | "MODEL_VERIFIED";

export type RunLog = {
  requestId: string;
  question: string;
  startedAt: string;
  durationMs: number;
  finalStatus: FinalStatus;
  knowledgeStatus: RuntimeKnowledgeStatus | null; // 확인 질문은 null
  contextSources: string[];
  retrievedContext?: { schema: string; semantic: string; examples: string; matches: RetrievedContext["matches"]; exampleMatches: RetrievedContext["exampleMatches"] };
  definitionVersion: string | null;
  initialSql: string | null;
  finalSql: string | null;
  attempts: Attempt[];
  failureReasons: string[];
  usage: LlmUsage[];
  models: { generator: string; verifier: string | null };
};
export interface RunLogger {
  save(log: RunLog): Promise<void>;
}

export type PipelineConfig = {
  maxRetries: number;
  semanticScoreThreshold: number;
  repeatedErrorLimit: number;
  llmTimeoutMs: number;
  executionTimeoutMs: number;
  models: { generator: string; verifier: string | null };
};

export type PipelineDeps = {
  retriever: ContextRetriever;
  generator: SqlGenerator;
  structural: StructuralValidator;
  verifier: SemanticVerifier;
  executor: QueryExecutor;
  formatter: ResultFormatter;
  logger: RunLogger;
  now?: () => number;
  newId?: () => string;
};
