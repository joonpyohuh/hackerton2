import { z } from "zod";
import { StageError } from "./errors";
import type { SqlGenerator } from "./types";
import type { ChatClient } from "@/server/llm/chat";
import { loadPrompt, renderPrompt } from "@/server/llm/prompts";
import { renderResolution } from "@/server/semantic/resolver";

export const generationResponseSchema = z.object({
  sql: z.string().nullable(),
  title: z.string().default(""),
  period: z.string().nullable().default(null),
  columnLabels: z.record(z.string(), z.string()).default({}),
  explanation: z.string().default(""),
  usedMetrics: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  needsClarification: z.boolean().default(false),
  clarificationQuestion: z.string().nullable().default(null),
  // 정의 준수 검사용 메타데이터 (v1 프롬프트)
  metricIds: z.array(z.string()).default([]),
  formula: z.string().default(""),
  filters: z.array(z.string()).default([]),
  grain: z.string().nullable().default(null),
  unapprovedAssumptions: z.array(z.string()).default([]),
});

const SYSTEM = "당신은 PostgreSQL SQL 생성기입니다. 지정된 JSON 객체 하나만 출력합니다.";

export function createSqlGenerator(options: {
  chat: ChatClient;
  model: string;
  dataNotes: string;
  promptVersion?: string;
  loadTemplate?: () => Promise<string>;
}): SqlGenerator {
  const version = options.promptVersion ?? "v1";
  const loadTemplate = options.loadTemplate ?? (() => loadPrompt("sql-generator", version));

  return {
    async generate({ question, context, feedback, resolution }, signal) {
      const user = renderPrompt(await loadTemplate(), {
        question,
        resolution: renderResolution(resolution),
        schema_context: context.schemaContext,
        data_notes: options.dataNotes,
        semantic_context: context.semanticContext || "(승인된 지표 정의 없음 — 정의가 필요한 지표는 확인 질문)",
        rag_examples: context.examples || "(없음)",
        feedback: feedback.length ? feedback.map((f) => `- ${f}`).join("\n") : "(첫 시도)",
      });
      const res = await options.chat({ model: options.model, system: SYSTEM, user, json: true }, signal);

      let raw: unknown;
      try {
        raw = JSON.parse(res.content);
      } catch {
        throw new StageError("invalid_response", "생성 모델 응답이 JSON 형식이 아닙니다.", true);
      }
      const parsed = generationResponseSchema.safeParse(raw);
      if (!parsed.success) {
        const where = parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ");
        throw new StageError("invalid_response", `생성 모델 응답 형식이 올바르지 않습니다: ${where}`, true);
      }
      const { metricIds, formula, filters, grain, unapprovedAssumptions, ...g } = parsed.data;
      return {
        ...g,
        sql: g.needsClarification ? null : g.sql,
        // definitionRefs(정의 버전)는 모델이 아니라 파이프라인이 컨텍스트에서 채운다.
        definition: { metricIds, definitionRefs: [], formula, filters, grain, unapprovedAssumptions, candidateIds: [] },
        usage: {
          stage: "generation",
          model: options.model,
          promptVersion: `sql-generator.${version}`,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
        },
      };
    },
  };
}
