import type { Pool } from "pg";

/**
 * Semantic Resolver가 "데이터에 실제로 있는 값"만으로 선택지를 만들 수 있도록 범주 값 목록을 읽는다.
 * 읽기 전용 계정으로 조회하며, 값은 프롬프트에 데이터로만 들어간다(지시문 아님).
 */
export type ValueHints = { text: string; loadedAt: number };

async function loadValueHints(pool: Pool): Promise<ValueHints> {
  const products = await pool.query<{ product_code: string; product_name: string | null }>(
    "SELECT DISTINCT product_code, product_name FROM analytics.payment_fact ORDER BY product_name, product_code",
  );
  const lines = products.rows.map((r) => `- ${r.product_code}: ${r.product_name ?? "(이름 없음)"}`);
  return {
    text: `[payment_fact 상품(product_code: product_name) ${products.rowCount}종 — 요금제 그룹 매핑은 공식 정의 없음]\n${lines.join("\n")}`,
    loadedAt: Date.now(),
  };
}

/** 값 목록 캐시 (기본 10분). */
export function createValueHintsCache(pool: Pool, ttlMs = 10 * 60_000) {
  let current: Promise<ValueHints> | null = null;
  const refresh = () => {
    current = loadValueHints(pool).catch((e: unknown) => {
      current = null;
      throw e;
    });
    return current;
  };
  return {
    async get(): Promise<string> {
      const hints = await (current ?? refresh());
      return (Date.now() - hints.loadedAt < ttlMs ? hints : await refresh()).text;
    },
  };
}
