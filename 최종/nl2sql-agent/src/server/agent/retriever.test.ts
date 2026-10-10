import { describe, expect, it } from "vitest";
import { SEED_DEFINITIONS } from "@/server/semantic/definitions";
import type { SemanticStore } from "@/server/semantic/store";
import type { DbMetadata } from "@/server/db/metadata";
import { createBasicRetriever } from "./retriever";

const definitions = SEED_DEFINITIONS.map((item) => ({ ...item, version: 1 }));
const tables = ["user_dim", "payment_fact", "watch_daily_fact", "behavior_fact", "content_dim", "content_genre_bridge", "user_content_summary"]
  .map((name) => ({ schema: "analytics", name, rowEstimate: 10, columns: [{ name: "user_key", type: "text", nullable: false }], constraints: [] }));
const metadata = { tables, catalog: {} as DbMetadata["catalog"], loadedAt: 0 };
const store = {
  list: async () => definitions,
  revision: async () => 7,
  approvedExamples: async () => [
    { requestId: "a", question: "초기 미시청률은?", sql: "SELECT 1", definitionIds: ["early_nonwatch_rate"] },
    { requestId: "b", question: "요금제 상품별 결제", sql: "SELECT 2", definitionIds: ["plan"] },
  ],
} as unknown as SemanticStore;
const retriever = createBasicRetriever({ getMetadata: async () => metadata, notesVersion: "test", store });
const signal = new AbortController().signal;

describe("질문별 Context 구성", () => {
  it("관련 정의·테이블·승인 사례만 프롬프트에 포함한다", async () => {
    const context = await retriever.retrieve("20대 초기 미시청률은?", signal);
    expect(context.matches?.map((m) => m.id)).toEqual(["early_nonwatch_rate", "age_band"]);
    expect(context.sources).toEqual(["analytics.user_dim", "analytics.payment_fact", "analytics.watch_daily_fact"]);
    expect(context.schemaContext).not.toContain("content_dim");
    expect(context.exampleMatches?.map((e) => e.requestId)).toEqual(["a"]);
    expect(context.examples).not.toContain("SELECT 2");
    expect(context.definitionVersion).toBe("semantic.v7");
  });
  it("원천 데이터가 없는 지표는 계산 대신 확인 요청으로 보낸다", async () => {
    const context = await retriever.retrieve("캠페인 반응률은?", signal);
    expect(context.isAmbiguous).toBe(true);
    expect(context.missingDefinitions).toContain("캠페인 반응률");
    expect(context.clarificationQuestion).toContain("필수 원천 데이터");
  });
});
