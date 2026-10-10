import type { Group, REdge, RNode } from "./types";

export const fmt = (n: number): string => n.toLocaleString("ko-KR");
export const pct = (v: number, d = 1): string => (v * 100).toFixed(d);
export const signed = (v: number, d = 1): string => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
export const phiText = (v: number): string => signed(v, 3);
export const pText = (p: number): string => (p < 0.001 ? "0.1% 미만" : (p * 100).toFixed(1) + "%");
/** φ in plain words: 0.70 → "0.70" with sign word. */
export const strengthNum = (v: number): string => Math.abs(v).toFixed(2);

export const GROUP_LABEL: Record<Group, string> = {
  attr: "고객 정보",
  beh: "가입 후 30일 행동",
  watch: "가입 후 60일 시청",
  outcome: "결제 · 시청 성과",
};
export const GROUP_ORDER: Group[] = ["attr", "beh", "watch", "outcome"];

export const otherEnd = (e: REdge, id: string): string => (e.source === id ? e.target : e.source);

/** Deterministic fact sentence. `flip` reads the edge from B's side. */
export function factSentence(e: REdge, nodes: Map<string, RNode>, flip = false): { lead: string; diff: string } {
  const a = nodes.get(flip ? e.target : e.source)?.label ?? "";
  const b = nodes.get(flip ? e.source : e.target)?.label ?? "";
  const yes = flip ? e.p_a_given_b : e.p_b_given_a;
  const no = flip ? e.p_a_given_not_b : e.p_b_given_not_a;
  const d = (yes - no) * 100;
  return {
    lead: `‘${a}’ 고객의 ${pct(yes)}%가 ‘${b}’`,
    diff: `그렇지 않은 고객은 ${pct(no)}% — ${Math.abs(d).toFixed(1)}%p ${d >= 0 ? "더 높아요" : "더 낮아요"}`,
  };
}

export type Importance = "high" | "mid" | "low";
/** Importance tier from association strength: ≥0.5 매우 중요, ≥0.35 중요, else 참고. */
export const importanceOf = (phi: number): Importance => (Math.abs(phi) >= 0.5 ? "high" : Math.abs(phi) >= 0.35 ? "mid" : "low");
export const IMP_COLOR: Record<Importance, string> = { high: "var(--imp-high)", mid: "var(--imp-mid)", low: "var(--imp-low)" };
export const IMP_LABEL: Record<Importance, string> = { high: "매우 중요", mid: "중요", low: "참고" };
