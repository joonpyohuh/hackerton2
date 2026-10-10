import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { GROUP_LABEL, IMP_COLOR, importanceOf, pct } from "../format";
import type { Importance } from "../format";
import type { Group, REdge, RNode, Selection } from "../types";
import { CENTER, H, RING, RX, W, edgePath, networkLayout, radialLayout, radiusOf } from "./layout";
import type { Layout, Pos } from "./layout";
import { EdgeTip } from "./EdgeTip";

interface Props {
  mode: "network" | "radial";
  nodes: RNode[];
  edges: REdge[];
  nodeMap: Map<string, RNode>;
  selection: Selection;
  aiEdges: Set<string>;
  focusNodes: Set<string>;
  emphasis: Set<string> | null;
  onSelect: (s: Selection) => void;
  onHoverNode: (id: string | null) => void;
}

const spring = { type: "spring", stiffness: 90, damping: 18, mass: 0.9 } as const;
const instant = { duration: 0 } as const;
const DRAG_THRESHOLD = 4; // px in screen space before a press becomes a drag

interface Drag { id: string; startX: number; startY: number; moved: boolean }

export function GraphView({ mode, nodes, edges, nodeMap, selection, aiEdges, focusNodes, emphasis, onSelect, onHoverNode }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; edge: REdge } | null>(null);
  // User-dragged positions, kept per view so network and radial can be arranged independently.
  const [moved, setMoved] = useState<Record<"network" | "radial", Map<string, Pos>>>({ network: new Map(), radial: new Map() });
  const [drag, setDrag] = useState<Drag | null>(null);

  const network = useMemo(() => networkLayout(nodes, edges), [nodes, edges]);
  const radial = useMemo(() => radialLayout(nodes), [nodes]);
  const base: Layout = mode === "network" ? network : radial.layout;
  const layout: Layout = useMemo(() => {
    const out = new Map(base);
    for (const [id, p] of moved[mode]) if (out.has(id)) out.set(id, p);
    return out;
  }, [base, moved, mode]);

  // A node is as important as its strongest visible connection.
  const nodeImp = useMemo(() => {
    const best = new Map<string, number>();
    for (const e of edges) for (const id of [e.source, e.target]) best.set(id, Math.max(best.get(id) ?? 0, Math.abs(e.phi)));
    return new Map<string, Importance>([...best].map(([id, v]) => [id, importanceOf(v)]));
  }, [edges]);

  const groupTags = useMemo(() => {
    if (mode !== "network") return [];
    const by = new Map<Group, number>();
    for (const n of nodes) { const p = network.get(n.id); if (p && !by.has(n.group)) by.set(n.group, p.x); }
    return [...by.entries()].map(([g, x]) => ({ g, x: x - 8, y: 16 }));
  }, [mode, nodes, network]);

  const selectedEdge = selection?.kind === "edge" ? selection.id : null;
  const selectedNode = selection?.kind === "node" ? selection.id : null;
  const ordered = useMemo(() => {
    const rank = (e: REdge) => (e.id === selectedEdge ? 3 : aiEdges.has(e.id) ? 2 : emphasis?.has(e.id) ? 1 : 0);
    return [...edges].sort((a, b) => rank(a) - rank(b) || Math.abs(a.phi) - Math.abs(b.phi));
  }, [edges, selectedEdge, aiEdges, emphasis]);

  const toSvg = (cx: number, cy: number): Pos | null => {
    const m = svg.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return { x: Math.max(20, Math.min(W - 20, p.x)), y: Math.max(20, Math.min(H - 20, p.y)) };
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (ev: PointerEvent) => {
      if (!drag.moved && Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < DRAG_THRESHOLD) return;
      const p = toSvg(ev.clientX, ev.clientY);
      if (!p) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      setMoved((m) => ({ ...m, [mode]: new Map(m[mode]).set(drag.id, p) }));
    };
    const onUp = () => {
      if (!drag.moved) onSelect(selectedNode === drag.id ? null : { kind: "node", id: drag.id });
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  });

  const dragging = drag?.moved ?? false;
  const motionT = dragging ? instant : spring;
  const hasMoved = moved[mode].size > 0;

  const showTip = (ev: React.PointerEvent, edge: REdge) => {
    if (dragging) return;
    const r = box.current?.getBoundingClientRect();
    if (r) setTip({ x: ev.clientX - r.left, y: ev.clientY - r.top, edge });
  };

  return (
    <div ref={box} className="relative">
      {hasMoved && (
        <button type="button" onClick={() => setMoved((m) => ({ ...m, [mode]: new Map() }))}
          className="absolute right-0 top-0 z-10 cursor-pointer border border-axis bg-bg px-3 py-1.5 text-[13px] text-ink-2 hover:border-ink hover:text-ink">
          위치 초기화
        </button>
      )}
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full select-none" role="img"
        aria-label={mode === "network" ? "지표 연결망" : "지표 원형 연결도"}
        onClick={(e) => { if (e.target === e.currentTarget) onSelect(null); }}>
        {mode === "radial" && (
          <g>
            <ellipse cx={CENTER.x} cy={CENTER.y} rx={RX} ry={RING} fill="none" stroke="var(--hair)" />
            {radial.arcs.map(({ group, a0, a1 }) => {
              const k = 0.86, mid = (a0 + a1) / 2;
              const pt = (a: number) => ({ x: CENTER.x + Math.cos(a) * RX * k, y: CENTER.y + Math.sin(a) * RING * k });
              const p0 = pt(a0), p1 = pt(a1), m = pt(mid);
              return (
                <g key={group}>
                  <motion.path initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8 }}
                    d={`M ${p0.x} ${p0.y} A ${RX * k} ${RING * k} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p1.x} ${p1.y}`}
                    fill="none" stroke="var(--axis)" strokeWidth={1} />
                  <text x={m.x + (CENTER.x - m.x) * 0.1} y={m.y + (CENTER.y - m.y) * 0.1} textAnchor="middle" dominantBaseline="middle"
                    fontSize={13} letterSpacing="0.08em" fill="var(--muted)" stroke="var(--bg)" strokeWidth={5} paintOrder="stroke">
                    {GROUP_LABEL[group]}
                  </text>
                </g>
              );
            })}
          </g>
        )}
        {groupTags.map((t) => (
          <motion.text key={t.g} initial={{ opacity: 0 }} animate={{ opacity: 1, x: t.x, y: t.y }} transition={spring}
            textAnchor="start" fontSize={13} letterSpacing="0.08em" fill="var(--muted)">
            {GROUP_LABEL[t.g]}
          </motion.text>
        ))}

        <g fill="none" strokeLinecap="round">
          <AnimatePresence>
            {ordered.map((e, i) => {
              const p = layout.get(e.source), q = layout.get(e.target);
              if (!p || !q) return null;
              const d = edgePath(p, q, mode);
              const ai = aiEdges.has(e.id), sel = e.id === selectedEdge;
              const dim = emphasis !== null && !emphasis.has(e.id) && !sel;
              const w = 2 + Math.abs(e.phi) * 9 + (sel ? 2 : 0);
              const opacity = dim ? 0.06 : sel || emphasis ? 1 : 0.85;
              const color = sel ? "var(--accent)" : IMP_COLOR[importanceOf(e.phi)];
              const neg = e.phi < 0;
              const dT = dragging ? instant : spring;
              return (
                <g key={e.id}>
                  {neg ? (
                    <motion.path initial={{ opacity: 0, d }} animate={{ opacity, d, strokeWidth: w }} exit={{ opacity: 0 }}
                      transition={{ d: dT, opacity: { duration: 0.4 } }} stroke={color} strokeDasharray="7 6" />
                  ) : (
                    <motion.path initial={{ pathLength: 0, opacity: 0, d }} animate={{ pathLength: 1, opacity, d, strokeWidth: w }}
                      exit={{ opacity: 0, transition: { duration: 0.25 } }}
                      transition={{ d: dT, pathLength: { duration: 0.9, delay: Math.min(i * 0.02, 0.6), ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 0.35 } }}
                      stroke={color} />
                  )}
                  {(ai || sel) && !dim && (
                    <motion.path initial={{ d }} animate={{ d }} transition={{ d: dT }} className="edge-ai" stroke="var(--bg)"
                      strokeWidth={Math.max(w / 3, 1.5)} strokeDasharray="2 10" style={{ pointerEvents: "none" }} />
                  )}
                  <motion.path initial={{ d }} animate={{ d }} transition={{ d: dT }} stroke="transparent" strokeWidth={18}
                    className="cursor-pointer" style={{ pointerEvents: dragging ? "none" : "stroke" }}
                    onPointerMove={(ev) => showTip(ev, e)} onPointerLeave={() => setTip(null)}
                    onClick={() => onSelect({ kind: "edge", id: e.id })}>
                    <title>{`${nodeMap.get(e.source)?.label} ↔ ${nodeMap.get(e.target)?.label}`}</title>
                  </motion.path>
                </g>
              );
            })}
          </AnimatePresence>
        </g>

        <g>
          {nodes.map((n) => {
            const p = layout.get(n.id);
            if (!p) return null;
            const r = radiusOf(n);
            const focus = focusNodes.has(n.id), sel = n.id === selectedNode;
            const imp = nodeImp.get(n.id);
            const t = radial.angle.get(n.id) ?? 0;
            const cos = Math.cos(t), sin = Math.sin(t);
            const labelPos = mode === "radial" && !moved.radial.has(n.id)
              ? { x: cos * (r + 9), y: sin * (r + 9), anchor: cos > 0.04 ? "start" : cos < -0.04 ? "end" : "middle", dy: sin > 0.9 ? 12 : sin < -0.9 ? -6 : 4 }
              : { x: r + 8, y: 0, anchor: "start", dy: 4 };
            const isDragged = drag?.id === n.id && dragging;
            return (
              <motion.g key={n.id} initial={{ opacity: 0, x: p.x, y: p.y }}
                animate={{ opacity: n.constant ? 0.35 : imp ? 1 : 0.45, x: p.x, y: p.y, scale: isDragged ? 1.12 : 1 }}
                transition={motionT} style={{ cursor: isDragged ? "grabbing" : "grab", touchAction: "none" }}
                onPointerDown={(ev) => { ev.preventDefault(); setTip(null); setDrag({ id: n.id, startX: ev.clientX, startY: ev.clientY, moved: false }); }}
                onPointerEnter={() => !drag && onHoverNode(n.id)} onPointerLeave={() => !drag && onHoverNode(null)}
                role="button" aria-label={`${n.label} — 끌어서 이동, 눌러서 선택`}>
                {focus && (
                  <motion.circle r={r + 6} fill="none" stroke="var(--accent)" strokeWidth={1.5}
                    animate={{ r: [r + 4, r + 10, r + 4], opacity: [0.9, 0.2, 0.9] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} />
                )}
                <circle r={r} fill={imp ? IMP_COLOR[imp] : "var(--surface)"}
                  stroke={sel || focus ? "var(--accent)" : "var(--ink)"}
                  strokeWidth={sel ? 3 : n.group === "outcome" ? 2.5 : 1.25} />
                <text x={labelPos.x} y={labelPos.y} dy={labelPos.dy} textAnchor={labelPos.anchor as "start" | "end" | "middle"}
                  fontSize={16} fontWeight={n.group === "outcome" ? 700 : 500} letterSpacing="-0.02em" fill="var(--ink)"
                  stroke="var(--bg)" strokeWidth={4} paintOrder="stroke" style={{ pointerEvents: "none" }}>
                  {n.label}
                  {mode === "network" && n.share !== null && (
                    <tspan fill="var(--muted)" fontWeight={400} fontSize={13} dx={5}>{pct(n.share)}%</tspan>
                  )}
                </text>
              </motion.g>
            );
          })}
        </g>
      </svg>
      <EdgeTip tip={tip} nodeMap={nodeMap} />
    </div>
  );
}
