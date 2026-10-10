import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { StageError } from "@/server/agent/errors";
import type { RetrievedContext } from "@/server/agent/types";
import { toLlmStageError, type ChatClient } from "@/server/llm/chat";
import { loadPrompt, renderPrompt } from "@/server/llm/prompts";
import { createSemanticVerifier } from "./semanticVerifier";

const CONTEXT: RetrievedContext = {
  schemaContext: "demo.orders(order_id, amount)",
  semanticContext: "",
  examples: "",
  isAmbiguous: false,
  clarificationQuestion: null,
  missingDefinitions: [],
  definitionVersion: null,
  sources: [],
};
const signal = new AbortController().signal;
const input = { question: "주문 금액 합계", sql: "SELECT sum(amount) FROM demo.orders", context: CONTEXT };

function verifierReturning(content: string) {
  const chat = vi.fn<ChatClient>(async () => ({ content, inputTokens: 120, outputTokens: 40 }));
  return { chat, verifier: createSemanticVerifier({ chat, model: "verifier-model", loadTemplate: async () => "{{question}}|{{sql}}" }) };
}

describe("SemanticVerifier", () => {
  it("정상 JSON을 판정으로 변환하고 사용량·프롬프트 버전을 기록한다", async () => {
    const { verifier, chat } = verifierReturning(JSON.stringify({ passed: true, score: 95, errors: [] }));
    const v = await verifier.verify(input, signal);
    expect(v).toMatchObject({ passed: true, score: 95, suggestions: [], missingDefinitions: [], needsClarification: false });
    expect(v.usage).toEqual({ stage: "verification", model: "verifier-model", promptVersion: "sql-verifier.v0", inputTokens: 120, outputTokens: 40 });
    expect(chat.mock.calls[0]?.[0]).toMatchObject({ model: "verifier-model", json: true, user: `${input.question}|${input.sql}` });
  });

  it("passed=true인데 오류가 있으면 실패로 본다", async () => {
    const { verifier } = verifierReturning(JSON.stringify({ passed: true, score: 92, errors: ["기간 조건 누락"] }));
    expect((await verifier.verify(input, signal)).passed).toBe(false);
  });

  it.each([
    ["JSON 아님", "좋아 보입니다", "JSON 형식이 아닙니다"],
    ["필수 필드 누락", JSON.stringify({ score: 90 }), "passed"],
    ["점수 범위 초과", JSON.stringify({ passed: true, score: 150 }), "score"],
    ["타입 오류", JSON.stringify({ passed: "yes", score: 90 }), "passed"],
  ])("§12-14 잘못된 응답(%s) → 재시도 가능 invalid_response", async (_, content, where) => {
    const { verifier } = verifierReturning(content);
    const err = await verifier.verify(input, signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StageError);
    expect(err).toMatchObject({ kind: "invalid_response", retryable: true });
    expect((err as StageError).message).toContain(where);
  });
});

describe("toLlmStageError", () => {
  const apiError = (status: number) => Object.assign(Object.create(OpenAI.APIError.prototype) as InstanceType<typeof OpenAI.APIError>, { status });
  it.each([
    [401, false],
    [403, false],
    [404, false],
    [400, false],
    [429, true],
    [500, true],
    [503, true],
  ])("HTTP %i → retryable=%s", (status, retryable) => {
    expect(toLlmStageError(apiError(status)).retryable).toBe(retryable);
  });

  it("연결 시간 초과는 재시도 가능, 사용자 취소는 불가", () => {
    const timeout = Object.create(OpenAI.APIConnectionTimeoutError.prototype) as Error;
    const abort = Object.create(OpenAI.APIUserAbortError.prototype) as Error;
    expect(toLlmStageError(timeout)).toMatchObject({ kind: "timeout", retryable: true });
    expect(toLlmStageError(abort)).toMatchObject({ kind: "aborted", retryable: false });
  });

  it("알 수 없는 오류는 재시도 불가로 본다", () => {
    expect(toLlmStageError(new Error("?")).retryable).toBe(false);
  });
});

describe("prompts", () => {
  it("실제 검증 프롬프트 파일의 변수를 모두 채울 수 있다", async () => {
    const template = await loadPrompt("sql-verifier", "v0");
    const out = renderPrompt(template, { question: "Q", sql: "S", schema_context: "C", data_notes: "N", semantic_context: "D" });
    expect(out).not.toMatch(/\{\{\w+\}\}/);
    expect(out).toContain("<question>\nQ\n</question>");
  });

  it("값이 없는 변수는 설정 오류", () => {
    expect(() => renderPrompt("{{missing}}", {})).toThrow(StageError);
  });

  it("없는 프롬프트 파일은 재시도 불가 설정 오류", async () => {
    await expect(loadPrompt("sql-verifier", "v999")).rejects.toMatchObject({ kind: "config", retryable: false });
  });
});
