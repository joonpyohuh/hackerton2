import { z } from "zod";
import { StageError } from "@/server/agent/errors";
import type { SemanticVerifier } from "@/server/agent/types";
import type { ChatClient } from "@/server/llm/chat";
import { loadPrompt, renderPrompt } from "@/server/llm/prompts";
import { renderResolution } from "@/server/semantic/resolver";

/** 2차 검증: 상위 모델을 독립 검증기로 사용. 응답은 반드시 이 스키마를 통과해야 한다. */
export const verdictResponseSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  errors: z.array(z.string()).default([]),
  suggestions: z.array(z.string()).default([]),
  missingDefinitions: z.array(z.string()).default([]),
  needsClarification: z.boolean().default(false),
  // 정의 준수 판정 — 응답에 없으면 통과로 보지 않는다(fail-closed)
  definitionMatch: z.boolean().default(false),
  grainMatch: z.boolean().default(false),
  unapprovedAssumptions: z.array(z.string()).default([]),
});

const SYSTEM = "당신은 SQL 의미 검증기입니다. 지정된 JSON 객체 하나만 출력합니다.";

export function createSemanticVerifier(options: {
  chat: ChatClient;
  model: string;
  dataNotes?: string;
  promptVersion?: string;
  loadTemplate?: () => Promise<string>;
}): SemanticVerifier {
  const version = options.promptVersion ?? "v1";
  const loadTemplate = options.loadTemplate ?? (() => loadPrompt("sql-verifier", version));

  return {
    async verify({ question, sql, context, resolution, definition }, signal) {
      const user = renderPrompt(await loadTemplate(), {
        question,
        sql,
        resolution: renderResolution(resolution),
        claimed: [
          `지표 ID: ${definition.metricIds.join(", ") || "없음"}`,
          `계산식: ${definition.formula || "(비어 있음)"}`,
          `필터: ${definition.filters.join("; ") || "없음"}`,
          `집계 단위: ${definition.grain ?? "(비어 있음)"}`,
        ].join("\n"),
        schema_context: context.schemaContext,
        data_notes: options.dataNotes ?? "(없음)",
        semantic_context: context.semanticContext || "(제공된 지표 정의 없음)",
      });
      const res = await options.chat({ model: options.model, system: SYSTEM, user, json: true }, signal);

      let raw: unknown;
      try {
        raw = JSON.parse(res.content);
      } catch {
        throw new StageError("invalid_response", "검증 모델 응답이 JSON 형식이 아닙니다.", true);
      }
      const parsed = verdictResponseSchema.safeParse(raw);
      if (!parsed.success) {
        const where = parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ");
        throw new StageError("invalid_response", `검증 모델 응답 형식이 올바르지 않습니다: ${where}`, true);
      }
      const v = parsed.data;
      return {
        ...v,
        // 모순 응답(passed=true인데 오류 존재)은 실패로 본다.
        passed: v.passed && v.errors.length === 0 && !v.needsClarification,
        usage: {
          stage: "verification",
          model: options.model,
          promptVersion: `sql-verifier.${version}`,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
        },
      };
    },
  };
}
