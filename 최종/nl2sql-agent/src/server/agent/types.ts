import type { Attempt, Cell, ConversationTurn, DefinitionUsage, FinalStatus, Resolution, ResolutionConcept, ResultTable } from "@/lib/agent/contract";
import type { StoredDefinition } from "@/server/semantic/definitions";

/**
 * 파이프라인 단계 인터페이스. 데이터 의존 구현체는 각 단계에서 작성한다.
 * 모든 비동기 단계는 signal을 받아 취소·타임아웃을 존중해야 한다.
 */

export type LlmUsage = {
  stage: "resolution" | "generation" | "verification" | "formatting";
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
  matches?: { id: string; name: string; kind: "metric" | "dimension" | "term"; score: number; version: number; via?: "resolver" | "lexical" }[];
  exampleMatches?: { requestId: string; question: string; score: number }[];
  /** 개념별 검색 결과: Resolver가 고른 정의(ids)와 동의어 검색으로 찾은 정의(synonyms) */
  concepts?: { phrase: string; role: ResolutionConcept["role"]; ids: string[]; synonyms: string[] }[];
  /** 컨텍스트에 포함한 정의 원본 — 정의 준수 검사에 쓴다 */
  definitions?: StoredDefinition[];
};
export interface ContextRetriever {
  /** focusIds: Semantic Resolver가 질문 의미로 고른 정의. 표현 일치 검색보다 먼저 포함한다. */
  retrieve(question: string, signal: AbortSignal, focusIds?: string[], concepts?: ResolutionConcept[]): Promise<RetrievedContext>;
}

// ── Semantic Resolver: SQL 생성 전 지표·기간·단위 판정 ──
export type ResolverInput = { question: string; history: ConversationTurn[] };
export type ResolverOutput = { resolution: Resolution; usage: LlmUsage | null };
export interface SemanticResolver {
  resolve(input: ResolverInput, signal: AbortSignal): Promise<ResolverOutput>;
}

// ── 08단계: SQL Generator ──
export type GenerationInput = {
  question: string;
  context: RetrievedContext;
  feedback: string[];
  attempt: number;
  resolution: Resolution;
};
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
  /** SQL이 적용한 공식 정의·계산식·필터·집계 단위·미승인 가정 */
  definition: DefinitionUsage;
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
  referencedTables?: string[]; // "schema.table" — 정의 준수 검사용
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
  /** SQL 계산식이 공식 정의와 일치하는가 — false면 점수와 무관하게 실패 */
  definitionMatch: boolean;
  /** 집계 단위가 정의·질문과 일치하는가 — false면 점수와 무관하게 실패 */
  grainMatch: boolean;
  /** 검증 모델이 찾은 사용자 미승인 업무 가정 — 하나라도 있으면 실패 */
  unapprovedAssumptions: string[];
  usage: LlmUsage;
};
export type VerifierInput = {
  question: string;
  sql: string;
  context: RetrievedContext;
  resolution: Resolution;
  definition: DefinitionUsage;
};
export interface SemanticVerifier {
  verify(input: VerifierInput, signal: AbortSignal): Promise<SemanticVerdict>;
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
  resolution?: Resolution;
  history?: ConversationTurn[];
  initialSql: string | null;
  finalSql: string | null;
  attempts: Attempt[];
  failureReasons: string[];
  usage: LlmUsage[];
  models: { generator: string; verifier: string | null; resolver?: string | null };
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
  models: { generator: string; verifier: string | null; resolver?: string | null };
};

export type PipelineDeps = {
  resolver: SemanticResolver;
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
