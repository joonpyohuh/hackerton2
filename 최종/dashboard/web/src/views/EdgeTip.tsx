import { signed } from "../format";
import type { REdge, RNode } from "../types";

interface Props {
  tip: { x: number; y: number; edge: REdge } | null;
  nodeMap: Map<string, RNode>;
}

/** Hover tooltip shared by every view. Click opens the full detail panel. */
export function EdgeTip({ tip, nodeMap }: Props) {
  if (!tip) return null;
  const e = tip.edge;
  return (
    <div className="pointer-events-none absolute z-20 bg-ink px-3 py-2 text-[14px] leading-[1.55] text-bg"
      style={{ left: tip.x + 14, top: tip.y + 14, maxWidth: 280 }}>
      <div className="font-semibold tracking-[-0.02em]">
        {nodeMap.get(e.source)?.label} ↔ {nodeMap.get(e.target)?.label}
      </div>
      <div className="num opacity-80">
        연관 {e.strength}{e.phi < 0 ? " · 반대로 움직임" : ""} · 차이 {signed(e.diff_pp)}%p
      </div>
      <div className="mt-0.5 opacity-60">클릭하면 자세히 볼 수 있어요</div>
    </div>
  );
}
