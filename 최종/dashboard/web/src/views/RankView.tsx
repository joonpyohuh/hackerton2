import { AnimatePresence, motion } from "framer-motion";
import { IMP_COLOR, IMP_LABEL, fmt, importanceOf, signed, strengthNum } from "../format";
import type { REdge, RNode, Selection } from "../types";

interface Props {
  edges: REdge[];
  nodeMap: Map<string, RNode>;
  selection: Selection;
  aiEdges: Set<string>;
  onSelect: (s: Selection) => void;
}

const LIMIT = 40;

/** |φ| ranking. Bars grow from a centre zero line so sign reads as direction. */
export function RankView({ edges, nodeMap, selection, aiEdges, onSelect }: Props) {
  const rows = edges.slice(0, LIMIT);
  const max = Math.max(...rows.map((e) => Math.abs(e.phi)), 0.1);
  const selected = selection?.kind === "edge" ? selection.id : null;
  return (
    <div>
      <div className="grid grid-cols-[28px_1fr_minmax(120px,32%)_72px_80px] gap-x-4 border-b border-ink pb-2 text-[13px] tracking-[0.02em] text-muted max-sm:grid-cols-[22px_1fr_72px]">
        <span>#</span><span>함께 움직이는 지표</span><span className="max-sm:hidden">연관 강도 (반대 ← 0 → 같이)</span>
        <span className="text-right">강도</span><span className="text-right max-sm:hidden">차이</span>
      </div>
      <motion.ol layout className="list-none">
        <AnimatePresence initial={false}>
          {rows.map((e, i) => {
            const hl = e.id === selected || aiEdges.has(e.id);
            const w = (Math.abs(e.phi) / max) * 50;
            return (
              <motion.li key={e.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                transition={{ layout: { type: "spring", stiffness: 260, damping: 30 }, opacity: { duration: 0.25, delay: Math.min(i * 0.015, 0.4) } }}>
                <button type="button" onClick={() => onSelect({ kind: "edge", id: e.id })}
                  className={`grid w-full cursor-pointer grid-cols-[28px_1fr_minmax(120px,32%)_72px_80px] items-center gap-x-4 border-b border-hair py-2.5 text-left transition-colors hover:bg-accent-wash max-sm:grid-cols-[22px_1fr_72px] ${hl ? "bg-accent-wash" : ""}`}>
                  <span className="num text-[14px] text-muted">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 text-[15px] leading-[1.45] tracking-[-0.015em]">
                    <span className={hl ? "font-semibold text-accent" : "font-medium"}>{nodeMap.get(e.source)?.label}</span>
                    <span className="mx-1.5 text-muted">↔</span>
                    <span className={hl ? "font-semibold text-accent" : "font-medium"}>{nodeMap.get(e.target)?.label}</span>
                    <span className="block text-[13px] text-muted">
                      {e.population === "payers" ? "결제 고객" : "가입 고객"} {fmt(e.n)}명 기준 · <b className="font-semibold" style={{ color: "var(--ink)" }}>{IMP_LABEL[importanceOf(e.phi)]}</b>
                    </span>
                  </span>
                  <span className="relative h-4 max-sm:hidden">
                    <span className="absolute inset-y-[-4px] left-1/2 w-px bg-axis" />
                    <motion.span className={`absolute inset-y-0 ${e.phi >= 0 ? "left-1/2 rounded-r-[3px]" : "right-1/2 rounded-l-[3px]"}`}
                      style={{ background: IMP_COLOR[importanceOf(e.phi)] }}
                      initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
                  </span>
                  <span className="num text-right text-[15px] font-semibold">{strengthNum(e.phi)}</span>
                  <span className="num text-right text-[14px] text-ink-2 max-sm:hidden">{signed(e.diff_pp)}%p</span>
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </motion.ol>
      {edges.length > LIMIT && <p className="mt-3 text-[13px] text-muted">상위 {LIMIT}개만 보여요 · 전체 {edges.length}개는 ‘표’ 보기에서 확인</p>}
    </div>
  );
}
