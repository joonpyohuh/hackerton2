import { motion } from "framer-motion";
import { GROUP_LABEL, fmt, otherEnd, pct, signed } from "../format";
import type { REdge, RNode } from "../types";

interface Props {
  node: RNode;
  edges: REdge[];
  nodeMap: Map<string, RNode>;
  onPickEdge: (id: string) => void;
  onBack: () => void;
}

export function NodeDetail({ node, edges, nodeMap, onPickEdge, onBack }: Props) {
  const linked = edges.filter((e) => e.source === node.id || e.target === node.id);
  return (
    <motion.div key={node.id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35 }}>
      <button type="button" onClick={onBack} className="mb-5 cursor-pointer text-[14px] text-muted underline underline-offset-[3px] hover:text-ink">← AI 분석으로 돌아가기</button>
      <div className="eyebrow">{GROUP_LABEL[node.group]}</div>
      <h2 className="mt-2 text-[20px] font-bold leading-[1.3] tracking-[-0.03em]">{node.label}</h2>
      <div className="mt-4 flex items-baseline gap-3">
        <span className="num text-[34px] font-semibold leading-none tracking-[-0.045em]">{node.share === null ? "—" : pct(node.share)}<small className="ml-0.5 text-[16px] font-medium">%</small></span>
        <span className="text-[14px] text-ink-2">{fmt(node.count)}명 / {node.population === "payers" ? "결제 고객" : "가입 고객"} {fmt(node.population_n)}명</span>
      </div>
      <h3 className="mb-2 mt-7 text-[13px] font-medium tracking-[0.06em] text-muted">함께 움직이는 지표 {linked.length}개 · 강한 순</h3>
      {linked.length === 0 && <p className="text-[14px] text-muted">지금 기준으로는 연결된 지표가 없어요. 위쪽 ‘최소 연관 강도’를 낮춰 보세요.</p>}
      <ol className="border-t border-ink">
        {linked.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onPickEdge(e.id)}
              className="grid w-full cursor-pointer grid-cols-[1fr_80px_72px] items-center gap-2 border-b border-hair py-2 text-left text-[14px] hover:bg-accent-wash">
              <span className="truncate font-medium tracking-[-0.015em]">{e.phi < 0 && <span className="mr-1 text-muted">⌁</span>}{nodeMap.get(otherEnd(e, node.id))?.label}</span>
              <span className="num text-right font-semibold">{e.strength}</span>
              <span className="num text-right text-[13px] text-ink-2">{signed(e.source === node.id ? e.diff_pp : e.diff_pp_rev)}%p</span>
            </button>
          </li>
        ))}
      </ol>
    </motion.div>
  );
}
