import { describe, expect, it } from "vitest";
import { agentEventSchema, type AgentEvent } from "@/lib/agent/contract";
import { createNdjsonParser, encodeNdjson } from "@/lib/agent/ndjson";
import { MOCK_EXAMPLES, pickScenario, runMockAgent } from "./mockAgent";

async function collect(question: string): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of runMockAgent(question, { delayMs: 0 })) out.push(e);
  return out;
}

describe("runMockAgent", () => {
  it.each(MOCK_EXAMPLES)("$scenario: 모든 이벤트가 계약 스키마를 통과하고 final로 끝난다", async ({ question, scenario }) => {
    expect(pickScenario(question)).toBe(scenario);
    const events = await collect(question);
    for (const e of events) expect(agentEventSchema.safeParse(e).success).toBe(true);
    const last = events.at(-1);
    expect(last?.type).toBe("final");
    if (last?.type === "final") expect(last.response.isMock).toBe(true);
  });

  it("재시도 시나리오는 의미 검증 실패 후 통과하며, 정답 확인과 구분된다", async () => {
    const last = (await collect(MOCK_EXAMPLES[0].question)).at(-1);
    if (last?.type !== "final" || last.response.status !== "passed") throw new Error("passed 아님");
    expect(last.response.attempts.map((a) => a.semantic.status)).toEqual(["failed", "passed"]);
    expect(last.response.meta.groundTruth).toBe("unverified");
  });

  it("실패한 시도는 실행 단계를 건너뛴다", async () => {
    const last = (await collect(MOCK_EXAMPLES[2].question)).at(-1);
    if (last?.type !== "final" || last.response.status !== "failed") throw new Error("failed 아님");
    expect(last.response.attempts.every((a) => a.execution.status === "skipped")).toBe(true);
  });
});

describe("NDJSON", () => {
  it("청크가 줄 중간에서 잘려도 이벤트를 복원한다", async () => {
    const text = (await collect(MOCK_EXAMPLES[1].question)).map(encodeNdjson).join("");
    const parser = createNdjsonParser((v) => agentEventSchema.parse(v));
    const parsed: AgentEvent[] = [];
    for (let i = 0; i < text.length; i += 7) parsed.push(...parser.push(text.slice(i, i + 7)));
    parsed.push(...parser.flush());
    expect(parsed.at(-1)?.type).toBe("final");
    expect(parsed.length).toBe(text.trim().split("\n").length);
  });
});
