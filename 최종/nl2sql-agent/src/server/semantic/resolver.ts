import { z } from "zod";
import type { ConversationTurn, Resolution, ResolutionOption, ResolutionStatus } from "@/lib/agent/contract";
import { StageError } from "@/server/agent/errors";
import type { SemanticResolver } from "@/server/agent/types";
import type { ChatClient } from "@/server/llm/chat";
import { loadPrompt, renderPrompt } from "@/server/llm/prompts";
import { DATA_COVERAGE, type CoverageColumn } from "./dataNotes";
import type { StoredDefinition } from "./definitions";
import { matchConcept } from "./search";

/**
 * Semantic Resolver — SQL 생성 전에 질문이 요구하는 지표·기간·집계 단위·필터를 판정한다.
 * LLM은 카탈로그에서 ID를 "제안"만 하고, 존재 여부·상태·데이터 범위·미승인 가정은 아래 코드가 다시 판정한다.
 * 정의에 없는 지표는 LLM이 resolved로 답해도 통과시키지 않는다.
 */

export const resolverResponseSchema = z.object({
  standaloneQuestion: z.string().default(""),
  requestedMetric: z.string().nullable().default(null),
  needsMetric: z.boolean().default(true),
  status: z.enum(["resolved", "ambiguous", "undefined", "unavailable", "no_metric"]),
  metricIds: z.array(z.string()).default([]),
  supportIds: z.array(z.string()).default([]),
  filters: z.array(z.string()).default([]),
  dateRange: z.object({ column: z.string(), start: z.string(), end: z.string() }).nullable().default(null),
  period: z.string().nullable().default(null),
  grain: z.string().nullable().default(null),
  relations: z.array(z.string()).default([]),
  unspecified: z.array(z.string()).default([]),
  confirmed: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  options: z.array(z.object({ label: z.string(), metricIds: z.array(z.string()).default([]) })).default([]),
  reason: z.string().nullable().default(null),
  // 질문 속 업무 개념별 대응 정의 (개념별 검색)
  concepts: z
    .array(z.object({ phrase: z.string(), role: z.enum(["metric", "dimension", "filter", "period", "term"]).catch("term"), ids: z.array(z.string()).default([]) }))
    .default([]),
  // 사용자가 계산 기준을 질문에 직접 말했거나 이전 턴에서 선택했는가
  criterionExplicit: z.boolean().default(false),
});
export type ResolverResponse = z.infer<typeof resolverResponseSchema>;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const clipList = (items: string[], maxItems: number, max = 500) =>
  [...new Set(items.map((s) => s.trim()).filter(Boolean))].slice(0, maxItems).map((s) => clip(s, max));
const unique = (items: string[]) => [...new Set(items)];

const COLUMN_LABEL: Record<CoverageColumn, string> = {
  signup_date: "가입일",
  payment_date: "결제일",
  watch_date: "시청일",
  event_date: "행동 발생일",
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 요청 기간과 데이터 관측 범위 비교. 범위 밖이면 계산 불가, 일부만 겹치면 그 사실을 알린다. */
export function checkDateRange(range: ResolverResponse["dateRange"]): { kind: "ok" } | { kind: "outside" | "partial"; message: string } {
  if (!range || !(range.column in DATA_COVERAGE) || !ISO_DATE.test(range.start) || !ISO_DATE.test(range.end)) return { kind: "ok" };
  const column = range.column as CoverageColumn;
  const cov = DATA_COVERAGE[column];
  const label = COLUMN_LABEL[column];
  if (range.end < cov.start || range.start > cov.end) {
    return {
      kind: "outside",
      message: `요청한 ${label} 기간(${range.start}~${range.end})은 데이터 범위(${cov.start}~${cov.end}) 밖이라 계산할 수 없습니다. 데이터가 있는 ${label} 기간으로 바꿔 질문하면 계산할 수 있습니다.`,
    };
  }
  if (range.start < cov.start || range.end > cov.end) {
    return { kind: "partial", message: `요청 기간 중 데이터가 있는 ${label} ${cov.start}~${cov.end}만 집계됩니다.` };
  }
  return { kind: "ok" };
}

function clarificationText(
  status: ResolutionStatus,
  requested: string | null,
  reasons: string[],
  options: ResolutionOption[],
  assumptions: string[],
): string | null {
  if (status === "resolved" || status === "no_metric") return null;
  const parts = [...reasons];
  if (!parts.length) {
    parts.push(
      status === "ambiguous"
        ? `'${requested ?? "요청한 지표"}'의 계산 기준이 하나로 정해지지 않았습니다.`
        : `'${requested ?? "요청한 지표"}'은(는) Semantic Layer에 공식 정의가 없어 임의로 계산하지 않습니다.`,
    );
  }
  if (options.length) {
    const head = status === "ambiguous" ? "어떤 기준으로 계산할까요?" : "데이터로 계산할 수 있는 기준:";
    parts.push(`${head} ${options.map((o, i) => `${i + 1}) ${o.label}`).join(" ")}`);
  }
  if (assumptions.length) parts.push(`확인이 필요한 가정: ${assumptions.join("; ")}`);
  return clip(parts.join(" "), 1000);
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * 자주 쓰는 상대 기간을 코드로 계산한다(모델의 날짜 계산을 믿지 않는다).
 * today는 Asia/Seoul 기준 YYYY-MM-DD.
 */
export function relativeRange(question: string, today: string): { label: string; start: string; end: string } | null {
  if (!ISO_DATE.test(today)) return null;
  const [y, m, d] = today.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const q = question.replace(/\s+/g, "");
  if (/(지난|저번)달/.test(q)) return { label: "지난달", start: ymd(new Date(Date.UTC(y, m - 2, 1))), end: ymd(new Date(Date.UTC(y, m - 1, 0))) };
  if (/이번달/.test(q)) return { label: "이번 달", start: ymd(new Date(Date.UTC(y, m - 1, 1))), end: today };
  const recent = /(최근|지난)(\d{1,3})일/.exec(q);
  if (recent) return { label: `최근 ${recent[2]}일`, start: ymd(new Date(t.getTime() - (Number(recent[2]) - 1) * 86_400_000)), end: today };
  if (/작년/.test(q)) return { label: "작년", start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
  if (/올해/.test(q)) return { label: "올해", start: `${y}-01-01`, end: today };
  return null;
}

function guessDateColumn(question: string): CoverageColumn | null {
  if (question.includes("가입")) return "signup_date";
  if (question.includes("결제")) return "payment_date";
  if (question.includes("시청")) return "watch_date";
  return null;
}

/** 상대 기간을 코드 계산값으로 덮어쓴다. 모델이 다른 날짜를 썼으면 문장 속 날짜도 함께 바꾼다. */
function applyRelativeDates(raw: ResolverResponse, question: string, today: string | undefined): ResolverResponse {
  const rel = today ? relativeRange(question, today) : null;
  if (!rel) return raw;
  const column = (raw.dateRange?.column as CoverageColumn | undefined) ?? guessDateColumn(question);
  if (!column || !(column in DATA_COVERAGE)) return raw;
  const old = raw.dateRange;
  const fix = (text: string) => (old ? text.split(old.start).join(rel.start).split(old.end).join(rel.end) : text);
  return {
    ...raw,
    dateRange: { column, start: rel.start, end: rel.end },
    standaloneQuestion: fix(raw.standaloneQuestion),
    filters: raw.filters.map(fix),
    period: raw.period ? fix(raw.period) : raw.period,
    unspecified: [...raw.unspecified, `상대 기간 '${rel.label}' → ${rel.start}~${rel.end} (오늘 ${today} 기준, 코드 계산)`],
  };
}

/**
 * 정책 A: 사용자가 쓴 지표 표현이 공식 지표의 이름·등록 별칭과 일치하면, 후보 대안이 있어도 되묻지 않고 공식 정의로 계산한다.
 * 모델이 모호하다고 판정해도 코드가 이 규칙을 강제한다. 대안은 응답에 메모로 남긴다.
 * 표현이 공식 정의의 이름·별칭이 아니면(예: "인기") 승격하지 않는다 — 공식 지표를 임의 해석에 끌어쓰지 않기 위해서다.
 */
function applyOfficialPriority(raw: ResolverResponse, byId: Map<string, StoredDefinition>): ResolverResponse {
  // criterionExplicit와 무관하다: 사용자가 공식 정의의 이름·별칭을 그대로 썼다면 그 자체가 기준을 말한 것이다.
  if (raw.status !== "ambiguous") return raw;
  const metricConcepts = raw.concepts.filter((c) => c.role === "metric");
  if (metricConcepts.length !== 1) return raw;
  const phrase = metricConcepts[0].phrase;
  const official = unique(metricConcepts[0].ids).filter((id) => {
    const d = byId.get(id);
    return d?.kind === "metric" && d.authority === "official" && d.status === "ready" && matchConcept(phrase, [d]).some((m) => m.score >= 90);
  });
  if (official.length !== 1) return raw;
  const name = byId.get(official[0])!.name;
  const others = raw.options.filter((o) => !o.metricIds.includes(official[0])).map((o) => o.label);
  return {
    ...raw,
    status: "resolved",
    metricIds: official,
    options: [],
    assumptions: [],
    unspecified: [
      ...raw.unspecified,
      `'${raw.requestedMetric ?? metricConcepts[0].phrase}' → 공식 정의 '${name}' 적용(공식 정의 우선)${others.length ? `. 다른 기준(후보): ${others.join(", ")}` : ""}`,
      ...raw.assumptions.map((a) => `판정 메모: ${a}`),
    ],
  };
}

/** LLM 제안을 Semantic Layer와 데이터 범위로 다시 판정한다. 결정론적이며 단위 테스트 대상이다. */
export function finalizeResolution(input: ResolverResponse, definitions: StoredDefinition[], question: string, today?: string): Resolution {
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const raw = applyOfficialPriority(applyRelativeDates(input, question, today), byId);
  const ready = (id: string) => byId.get(id)?.status === "ready";

  const unknownIds = raw.metricIds.filter((id) => !byId.has(id));
  const notReady = unique(raw.metricIds.filter((id) => byId.get(id)?.status === "needs_data"));
  const metricIds = unique(raw.metricIds.filter(ready)).slice(0, 5);
  const supportIds = unique(raw.supportIds.filter((id) => byId.has(id) && !metricIds.includes(id))).slice(0, 10);
  const options = raw.options
    .map((o) => ({ label: clip(o.label.trim(), 200), metricIds: unique(o.metricIds).slice(0, 5) }))
    .filter((o) => o.label && o.metricIds.length > 0 && o.metricIds.every(ready))
    .slice(0, 5);
  const assumptions = clipList(raw.assumptions, 10);
  const unspecified = clipList(raw.unspecified, 10);
  const requested = raw.requestedMetric?.trim() || null;

  const reasons: string[] = [];
  let status: ResolutionStatus = raw.status;

  // 개념별 대응: 존재하는 정의 ID만 남긴다. 지표 개념인데 대응 정의가 없으면 질문 전체를 확보했다고 보지 않는다.
  const concepts = raw.concepts.slice(0, 8).map((c) => ({
    phrase: clip(c.phrase.trim(), 100),
    role: c.role,
    ids: unique(c.ids.filter((id) => byId.has(id))).slice(0, 5),
  }));
  const uncoveredMetricConcepts = concepts.filter((c) => c.role === "metric" && c.ids.length === 0).map((c) => c.phrase);

  // 후보(비공식) 지표는 사용자가 기준을 직접 말했거나 다른 계산 해석이 없을 때만 바로 쓴다.
  const isCandidate = (id: string) => byId.get(id)?.authority !== "official";
  const candidateMetric = metricIds.some(isCandidate);
  const competing = options.filter((o) => o.metricIds.some((id) => !metricIds.includes(id)));

  const range = checkDateRange(raw.dateRange);
  if (range.kind === "partial") unspecified.push(range.message);

  // 1) 계산 불가: 데이터 범위 밖, 원천 데이터 없는 정의
  if (range.kind === "outside") reasons.push(range.message);
  for (const id of notReady) reasons.push(`${byId.get(id)!.name}: ${byId.get(id)!.missing}`);

  // 2) 정의 없음: 지표가 필요한데 공식 ID가 없거나, 카탈로그에 없는 ID를 제안
  const wantsResolved = status === "resolved" || status === "no_metric";
  let undefinedMetric = status === "undefined";
  if (wantsResolved && raw.needsMetric && metricIds.length === 0) undefinedMetric = true;
  if (wantsResolved && unknownIds.length > 0) undefinedMetric = true;
  if (wantsResolved && uncoveredMetricConcepts.length > 0) {
    undefinedMetric = true;
    reasons.push(`'${uncoveredMetricConcepts.join("', '")}'에 해당하는 공식 정의나 계산 가능한 후보 정의가 없습니다.`);
  }
  const needsChoice = wantsResolved && !undefinedMetric && candidateMetric && !raw.criterionExplicit && competing.length > 0;
  if (undefinedMetric) {
    const llmReason = status === "undefined" ? raw.reason?.trim() : null;
    reasons.push(llmReason || `'${requested ?? "요청한 지표"}'은(는) Semantic Layer에 공식 정의가 없어 임의로 계산하지 않습니다.`);
  }

  if (range.kind === "outside" || notReady.length > 0) status = "unavailable";
  else if (undefinedMetric) status = "undefined";
  else if (status === "unavailable") reasons.push(raw.reason?.trim() || "현재 데이터로 계산할 수 없습니다.");
  else if (wantsResolved && assumptions.length > 0) status = "ambiguous";
  else if (needsChoice) {
    status = "ambiguous";
    reasons.push(`'${requested ?? "요청한 지표"}'의 공식 정의가 없어 계산 기준을 정해야 합니다.`);
  }
  else if (status === "ambiguous") {
    if (options.length === 0 && assumptions.length === 0) {
      status = "undefined";
      reasons.push(`'${requested ?? "요청한 지표"}'을(를) 계산할 수 있는 공식 정의가 없습니다.`);
    } else if (raw.reason?.trim()) reasons.push(raw.reason.trim());
  }

  const resolved = status === "resolved" || status === "no_metric";
  return {
    status,
    standaloneQuestion: clip(raw.standaloneQuestion.trim() || question, 1000),
    requestedMetric: requested ? clip(requested, 200) : null,
    metricIds: resolved ? metricIds : [],
    supportIds,
    filters: clipList(raw.filters, 10),
    period: raw.period ? clip(raw.period, 300) : null,
    grain: raw.grain ? clip(raw.grain, 200) : null,
    relations: clipList(raw.relations, 10),
    unspecified: unspecified.slice(0, 10),
    confirmed: clipList(raw.confirmed, 10),
    assumptions,
    options: resolved ? [] : options,
    reason: reasons.length ? clip(reasons.join(" "), 1000) : null,
    clarificationQuestion: clarificationText(status, requested, unique(reasons), resolved ? [] : options, assumptions),
    concepts,
    candidateIds: resolved ? unique([...metricIds, ...supportIds].filter(isCandidate)) : [],
  };
}

/** 프롬프트용 카탈로그. 컬럼 사전(col_*)은 지표 판정에 쓰지 않으므로 제외한다. */
export function renderCatalog(definitions: StoredDefinition[]): string {
  const line = (d: StoredDefinition) => {
    const alias = d.aliases.length ? ` | 별칭: ${d.aliases.join(", ")}` : "";
    const basis = d.authority === "official" ? "공식" : "후보(비공식)";
    if (d.kind === "metric") {
      return `- [metric/${basis}] ${d.id} | ${d.name}${alias} | 분자: ${d.numerator ?? "-"} | 분모: ${d.denominator ?? "-"} | 집계 단위: ${d.grain} | 기간: ${d.period} | 상태: ${d.status}`;
    }
    return `- [${d.kind}/${basis}] ${d.id} | ${d.name}${alias} | ${d.description} | 집계 단위: ${d.grain} | 기간: ${d.period} | 상태: ${d.status}`;
  };
  const order = { metric: 0, dimension: 1, term: 2 } as const;
  return definitions
    .filter((d) => !d.id.startsWith("col_"))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.id.localeCompare(b.id))
    .map(line)
    .join("\n");
}

export function renderHistory(history: ConversationTurn[]): string {
  if (!history.length) return "(이전 대화 없음)";
  return history
    .map((t, i) => {
      const r = t.resolution;
      const facts = r
        ? [
            `판정 ${r.status}`,
            r.requestedMetric && `요청 지표 ${r.requestedMetric}`,
            r.metricIds.length && `지표 ID ${r.metricIds.join(", ")}`,
            r.filters.length && `필터 ${r.filters.join("; ")}`,
            r.period && `기간 ${r.period}`,
            r.confirmed.length && `확정 조건 ${r.confirmed.join("; ")}`,
            r.options.length && `제시한 선택지 ${r.options.map((o) => `${o.label}(${o.metricIds.join("+")})`).join(" / ")}`,
          ].filter(Boolean)
        : [];
      return [
        `[턴 ${i + 1}] 사용자: ${t.question}`,
        `  결과: ${t.status}${t.clarificationQuestion ? ` / 시스템이 물은 것: ${t.clarificationQuestion}` : ""}`,
        facts.length ? `  해석: ${facts.join(" / ")}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

/** 생성·검증 프롬프트에 넣는 판정 결과. */
export function renderResolution(r: Resolution): string {
  const list = (items: string[]) => (items.length ? items.join("; ") : "없음");
  return [
    `판정: ${r.status}`,
    `완결 질문: ${r.standaloneQuestion}`,
    `요청 지표 표현: ${r.requestedMetric ?? "없음"}`,
    `사용할 공식 지표 ID: ${list(r.metricIds)}`,
    `함께 쓰는 차원·용어 ID: ${list(r.supportIds)}`,
    `필터: ${list(r.filters)}`,
    `기간: ${r.period ?? "지정 없음"}`,
    `집계 단위: ${r.grain ?? "지정 없음"}`,
    `테이블 관계: ${list(r.relations)}`,
    `정의 기본값을 적용한 조건: ${list(r.unspecified)}`,
    `사용자가 확정한 조건: ${list(r.confirmed)}`,
    `후보(비공식) 정의 — 응답에 후보임을 밝힐 것: ${list(r.candidateIds)}`,
    `개념별 대응: ${r.concepts.length ? r.concepts.map((c) => `${c.phrase}(${c.role})→${c.ids.join("+") || "없음"}`).join("; ") : "없음"}`,
  ].join("\n");
}

export function renderCoverage(): string {
  return (Object.keys(DATA_COVERAGE) as CoverageColumn[])
    .map((c) => `- ${c}(${COLUMN_LABEL[c]}): ${DATA_COVERAGE[c].start} ~ ${DATA_COVERAGE[c].end}`)
    .join("\n");
}

export const seoulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

const SYSTEM = "당신은 업무 지표 판정기입니다. 지정된 JSON 객체 하나만 출력합니다.";

export function createSemanticResolver(options: {
  chat: ChatClient;
  model: string;
  listDefinitions: () => Promise<StoredDefinition[]>;
  valueHints: () => Promise<string>;
  today?: () => string;
  promptVersion?: string;
  loadTemplate?: () => Promise<string>;
}): SemanticResolver {
  const version = options.promptVersion ?? "v1";
  const loadTemplate = options.loadTemplate ?? (() => loadPrompt("semantic-resolver", version));
  const today = options.today ?? seoulToday;

  return {
    async resolve({ question, history }, signal) {
      const [definitions, hints, template] = await Promise.all([options.listDefinitions(), options.valueHints(), loadTemplate()]);
      const user = renderPrompt(template, {
        today: today(),
        coverage: renderCoverage(),
        catalog: renderCatalog(definitions),
        value_hints: hints,
        history: renderHistory(history),
        question,
      });
      const res = await options.chat({ model: options.model, system: SYSTEM, user, json: true }, signal);
      let raw: unknown;
      try {
        raw = JSON.parse(res.content);
      } catch {
        throw new StageError("invalid_response", "지표 판정 모델 응답이 JSON 형식이 아닙니다.", true);
      }
      const parsed = resolverResponseSchema.safeParse(raw);
      if (!parsed.success) {
        const where = parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ");
        throw new StageError("invalid_response", `지표 판정 모델 응답 형식이 올바르지 않습니다: ${where}`, true);
      }
      return {
        resolution: finalizeResolution(parsed.data, definitions, question, today()),
        usage: {
          stage: "resolution",
          model: options.model,
          promptVersion: `semantic-resolver.${version}`,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
        },
      };
    },
  };
}
