import { motion } from "framer-motion";
import { Fragment } from "react";
import { pct, strengthNum } from "../format";
import type { REdge, RNode, VizKind } from "../types";

interface Props {
  kind: VizKind;
  edge: REdge;
  nodeMap: Map<string, RNode>;
}

const ease = [0.22, 1, 0.36, 1] as const;
const lab = (m: Map<string, RNode>, id: string) => m.get(id)?.label ?? id;

export const VIZ_LABEL: Record<VizKind, string> = { bar: "막대", donut: "원형", gauge: "강도계", dots: "100명 점", mosaic: "면적" };

/** One edge, five shapes. Every value is read straight from the server-computed edge. */
export function MiniViz({ kind, edge, nodeMap }: Props) {
  const a = lab(nodeMap, edge.source), b = lab(nodeMap, edge.target);
  const caption = <div className="mb-2 text-[13px] leading-[1.45] text-ink-2">‘{a}’ 고객과 아닌 고객의 <b className="font-semibold text-ink">{b}</b> 비율</div>;
  switch (kind) {
    case "bar": return <div>{caption}<Bars edge={edge} /></div>;
    case "donut": return <div>{caption}<Donut edge={edge} /></div>;
    case "gauge": return <div><div className="mb-2 text-[13px] text-ink-2">{a} ↔ {b} · 연관 강도</div><Gauge phi={edge.phi} /></div>;
    case "dots": return <div>{caption}<Dots edge={edge} /></div>;
    case "mosaic": return <div><div className="mb-2 text-[13px] text-ink-2">면적 = 고객 수</div><Mosaic edge={edge} a={a} b={b} /></div>;
  }
}

function Bars({ edge }: { edge: REdge }) {
  const rows: [string, number, boolean][] = [["해당 고객", edge.p_b_given_a, true], ["그 외 고객", edge.p_b_given_not_a, false]];
  return (
    <div className="grid gap-1.5">
      {rows.map(([k, v, hi]) => (
        <div key={k} className="grid grid-cols-[96px_1fr_44px] items-center gap-2 text-[13px]">
          <span className="truncate text-ink-2">{k}</span>
          <span className="h-4"><motion.span className="block h-full rounded-r-[3px]" style={{ background: hi ? "var(--accent)" : "var(--bar-2)" }}
            initial={{ width: 0 }} animate={{ width: `${v * 100}%` }} transition={{ duration: 0.8, ease }} /></span>
          <span className={`num text-right ${hi ? "font-semibold text-ink" : "text-ink-2"}`}>{pct(v)}%</span>
        </div>
      ))}
    </div>
  );
}

function Ring({ r, v, color, w }: { r: number; v: number; color: string; w: number }) {
  const c = 2 * Math.PI * r;
  return (
    <>
      <circle r={r} fill="none" stroke="var(--hair)" strokeWidth={w} />
      <motion.circle r={r} fill="none" stroke={color} strokeWidth={w} strokeLinecap="butt" transform="rotate(-90)"
        strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - v) }} transition={{ duration: 0.9, ease }} />
    </>
  );
}

function Donut({ edge }: { edge: REdge }) {
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="-50 -50 100 100" className="h-[128px] w-[128px] shrink-0" aria-hidden>
        <Ring r={40} v={edge.p_b_given_a} color="var(--accent)" w={8} />
        <Ring r={27} v={edge.p_b_given_not_a} color="var(--bar)" w={6} />
        <text textAnchor="middle" dy={4} fontSize={15} fontWeight={600} fill="var(--ink)" className="num">{pct(edge.p_b_given_a, 0)}%</text>
      </svg>
      <dl className="grid gap-1 text-[13px]">
        <div className="flex items-center gap-2"><i className="block h-[3px] w-3 bg-accent" /><dt className="text-ink-2">바깥 · 해당 고객</dt><dd className="num font-semibold">{pct(edge.p_b_given_a)}%</dd></div>
        <div className="flex items-center gap-2"><i className="block h-[3px] w-3 bg-bar" /><dt className="text-ink-2">안쪽 · 그 외 고객</dt><dd className="num font-semibold">{pct(edge.p_b_given_not_a)}%</dd></div>
      </dl>
    </div>
  );
}

export function Gauge({ phi, large = false }: { phi: number; large?: boolean }) {
  const R = 44, toXY = (v: number) => {
    const t = Math.PI * (1 - (v + 1) / 2);
    return { x: Math.cos(t) * R, y: -Math.sin(t) * R };
  };
  const p0 = toXY(-1), p1 = toXY(1);
  const zones = [0.1, 0.3, 0.5];
  const tip = { x: toXY(phi).x * ((R - 4) / R), y: toXY(phi).y * ((R - 4) / R) };
  return (
    <svg viewBox="-56 -54 112 66" className={large ? "h-[120px] w-full max-w-[240px]" : "h-[84px] w-full max-w-[170px]"} aria-label={`연관 강도 ${strengthNum(phi)}`}>
      <path d={`M ${p0.x} ${p0.y} A ${R} ${R} 0 0 1 ${p1.x} ${p1.y}`} fill="none" stroke="var(--hair)" strokeWidth={6} />
      {[...zones, ...zones.map((z) => -z)].map((z) => { const p = toXY(z), q = { x: p.x * 1.16, y: p.y * 1.16 }; return <line key={z} x1={p.x * 0.86} y1={p.y * 0.86} x2={q.x} y2={q.y} stroke="var(--axis)" />; })}
      <motion.line x1={0} y1={0} initial={{ x2: 0, y2: -(R - 4) }} animate={{ x2: tip.x, y2: tip.y }}
        transition={{ type: "spring", stiffness: 70, damping: 14 }} stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" />
      <circle r={3} fill="var(--ink)" />
      <text x={p0.x} y={10} textAnchor="middle" fontSize={9} fill="var(--muted)">반대</text>
      <text x={0} y={-R - 3} textAnchor="middle" fontSize={9} fill="var(--muted)">0</text>
      <text x={p1.x} y={10} textAnchor="middle" fontSize={9} fill="var(--muted)">같이</text>
      <text x={0} y={10} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--ink)" className="num">강도 {strengthNum(phi)}</text>
    </svg>
  );
}

function Waffle({ v, hi }: { v: number; hi: boolean }) {
  const k = Math.round(v * 100);
  return (
    <svg viewBox="0 0 100 100" className="h-[104px] w-[104px]" aria-hidden>
      {Array.from({ length: 100 }, (_, i) => (
        <motion.circle key={i} cx={(i % 10) * 10 + 5} cy={Math.floor(i / 10) * 10 + 5} r={3.4}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.004 }}
          fill={i < k ? (hi ? "var(--accent)" : "var(--bar)") : "var(--hair)"} />
      ))}
    </svg>
  );
}

function Dots({ edge }: { edge: REdge }) {
  return (
    <div className="flex gap-5">
      {([["해당 고객", edge.p_b_given_a, true], ["그 외 고객", edge.p_b_given_not_a, false]] as const).map(([k, v, hi]) => (
        <figure key={k} className="grid gap-1">
          <Waffle v={v} hi={hi} />
          <figcaption className="text-[13px] leading-[1.4] text-ink-2"><span className="block max-w-[96px] truncate">{k} 100명당</span><b className="num text-ink">{Math.round(v * 100)}명</b></figcaption>
        </figure>
      ))}
    </div>
  );
}

export function Mosaic({ edge, a, b, height = 96 }: { edge: REdge; a: string; b: string; height?: number }) {
  const W = 220, H = height, g = 2;
  const wa = Math.max(W * edge.p_a, 6), wn = W - wa - g;
  const cols = [
    { x: 0, w: wa, yes: edge.p_b_given_a, n: edge.table.both + edge.table.a_only, hi: true, name: a },
    { x: wa + g, w: wn, yes: edge.p_b_given_not_a, n: edge.table.b_only + edge.table.neither, hi: false, name: `${a} 아님` },
  ];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[300px]" aria-hidden>
        {cols.map((c) => {
          const hy = (H - g) * c.yes;
          return (
            <g key={c.name}>
              <motion.rect x={c.x} width={c.w} rx={2} fill={c.hi ? "var(--accent)" : "var(--bar)"}
                initial={{ y: H, height: 0 }} animate={{ y: H - hy, height: hy }} transition={{ duration: 0.8, ease }} />
              <motion.rect x={c.x} y={0} width={c.w} rx={2} fill="var(--bar-2)" opacity={0.6}
                initial={{ height: 0 }} animate={{ height: H - hy - g }} transition={{ duration: 0.8, ease }} />
            </g>
          );
        })}
      </svg>
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-[12px] leading-[1.6]">
        {cols.map((c) => <Fragment key={c.name}><span className="text-ink-2">{c.hi ? "왼쪽" : "오른쪽"} · {c.name}</span><span className="num text-muted">{c.n.toLocaleString("ko-KR")}명</span></Fragment>)}
      </div>
      <div className="mt-1 flex gap-4 text-[12px] text-ink-2">
        <span className="flex items-center gap-1.5"><i className="block h-2 w-2 bg-accent" />{b}</span>
        <span className="flex items-center gap-1.5"><i className="block h-2 w-2 bg-bar-2" />{b} 아님</span>
      </div>
    </div>
  );
}
