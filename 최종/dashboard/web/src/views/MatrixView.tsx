import { motion } from "framer-motion";
import { useMemo, useRef, useState } from "react";
import { GROUP_ORDER, IMP_COLOR, importanceOf } from "../format";
import type { REdge, RNode, Selection } from "../types";
import { EdgeTip } from "./EdgeTip";

interface Props {
  nodes: RNode[];
  allEdges: REdge[];
  visible: Set<string>;
  nodeMap: Map<string, RNode>;
  selection: Selection;
  aiEdges: Set<string>;
  onSelect: (s: Selection) => void;
}

const S = 28, LW = 170, TH = 150, GAP = 8;

/** φ heatmap. Positive = accent fill, negative = hatched ink (shape, not colour alone). */
export function MatrixView({ nodes, allEdges, visible, nodeMap, selection, aiEdges, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; edge: REdge } | null>(null);

  const order = useMemo(() => GROUP_ORDER.flatMap((g) => nodes.filter((n) => n.group === g)), [nodes]);
  const offset = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    order.forEach((n, i) => {
      if (i > 0 && order[i - 1]?.group !== n.group) acc += GAP;
      out.push(acc + i * S);
    });
    return out;
  }, [order]);
  const pair = useMemo(() => {
    const m = new Map<string, REdge>();
    for (const e of allEdges) { m.set(e.source + "|" + e.target, e); m.set(e.target + "|" + e.source, e); }
    return m;
  }, [allEdges]);
  const size = (offset[offset.length - 1] ?? 0) + S;
  const selected = selection?.kind === "edge" ? selection.id : null;

  return (
    <div ref={box} className="relative overflow-x-auto">
      <svg viewBox={`0 0 ${LW + size + 8} ${TH + size + 8}`} className="block h-auto w-full min-w-[640px]" role="img" aria-label="지표 연관 표">
        <defs>
          <pattern id="neg-hatch" patternUnits="userSpaceOnUse" width={4} height={4} patternTransform="rotate(45)">
            <rect width={4} height={4} fill="var(--bar-2)" />
            <line x1={0} y1={0} x2={0} y2={4} stroke="var(--ink-2)" strokeWidth={1.6} />
          </pattern>
        </defs>
        {order.map((n, i) => (
          <g key={n.id}>
            <text x={LW - 10} y={TH + (offset[i] ?? 0) + S / 2 + 4} textAnchor="end" fontSize={13}
              fill={hover?.r === i ? "var(--ink)" : "var(--ink-2)"} fontWeight={hover?.r === i ? 600 : 400}>{n.label}</text>
            <text transform={`translate(${LW + (offset[i] ?? 0) + S / 2 + 4} ${TH - 8}) rotate(-55)`} fontSize={13}
              fill={hover?.c === i ? "var(--ink)" : "var(--ink-2)"} fontWeight={hover?.c === i ? 600 : 400}>{n.label}</text>
          </g>
        ))}
        <g transform={`translate(${LW} ${TH})`}>
          {order.map((rn, r) => order.map((cn, c) => {
            const x = offset[c] ?? 0, y = offset[r] ?? 0;
            if (r === c) return <rect key={rn.id + cn.id} x={x + 1} y={y + 1} width={S - 2} height={S - 2} fill="var(--hair)" />;
            const e = pair.get(rn.id + "|" + cn.id);
            if (!e) return <circle key={rn.id + cn.id} cx={x + S / 2} cy={y + S / 2} r={1} fill="var(--axis)" />;
            const on = visible.has(e.id);
            const a = Math.abs(e.phi);
            const hl = e.id === selected || aiEdges.has(e.id);
            return (
              <g key={rn.id + cn.id} className="cursor-pointer"
                onPointerEnter={() => setHover({ r, c })}
                onPointerMove={(ev) => { const b = box.current?.getBoundingClientRect(); if (b) setTip({ x: ev.clientX - b.left + box.current!.scrollLeft, y: ev.clientY - b.top, edge: e }); }}
                onPointerLeave={() => { setHover(null); setTip(null); }}
                onClick={() => onSelect({ kind: "edge", id: e.id })}>
                <rect x={x} y={y} width={S} height={S} fill="transparent" />
                <motion.rect x={x + 1} y={y + 1} width={S - 2} height={S - 2} rx={2}
                  fill={e.phi >= 0 ? IMP_COLOR[importanceOf(e.phi)] : "url(#neg-hatch)"}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: on ? 0.95 : a >= 0.1 && e.significant ? 0.2 : 0.05 }}
                  transition={{ duration: 0.5, delay: Math.min((r + c) * 0.012, 0.5) }} />
                {(hl || (hover?.r === r && hover?.c === c)) && (
                  <rect x={x + 0.5} y={y + 0.5} width={S - 1} height={S - 1} rx={2} fill="none"
                    stroke={hl ? "var(--accent)" : "var(--ink)"} strokeWidth={1.5} />
                )}
              </g>
            );
          }))}
          {hover && (
            <g pointerEvents="none">
              <rect x={-LW} y={offset[hover.r] ?? 0} width={LW + size} height={S} fill="none" stroke="var(--axis)" />
              <rect x={offset[hover.c] ?? 0} y={-TH} width={S} height={TH + size} fill="none" stroke="var(--axis)" />
            </g>
          )}
        </g>
      </svg>
      <EdgeTip tip={tip} nodeMap={nodeMap} />
    </div>
  );
}
