import { describe, expect, it } from "vitest";
import { SEED_DEFINITIONS, definitionSchema } from "./definitions";
import { matchDefinitions, scoreText } from "./search";

const definitions = SEED_DEFINITIONS.map((item) => ({ ...definitionSchema.parse(item), version: 1 }));

describe("질문별 시맨틱 검색", () => {
  it("PDF 요구 지표·차원·업무 용어가 유효한 정의로 등록된다", () => {
    expect(definitions.filter((d) => d.kind === "metric").length).toBeGreaterThanOrEqual(3);
    expect(definitions.filter((d) => d.kind === "dimension")).toHaveLength(3);
    expect(definitions.filter((d) => d.kind === "term").length).toBeGreaterThanOrEqual(3);
  });
  it("20대 초기 미시청률 질문에 관련 정의를 우선 검색한다", () => {
    const hits = matchDefinitions("20대의 초기 미시청률을 알려줘", definitions);
    expect(hits[0]?.id).toBe("early_nonwatch_rate");
    expect(hits.some((h) => h.id === "age_band")).toBe(true);
    expect(hits.map((h) => h.id)).toEqual(["early_nonwatch_rate", "age_band"]);
  });
  it("없는 데이터의 지표도 검색되며 상태는 needs_data다", () => {
    const id = matchDefinitions("캠페인 반응률", definitions)[0]?.id;
    expect(definitions.find((d) => d.id === id)?.status).toBe("needs_data");
  });
  it("관련 없는 승인 사례는 검색 점수 0으로 제외할 수 있다", () => {
    expect(scoreText("초기 미시청률", "요금제별 결제")).toBe(0);
  });
});
