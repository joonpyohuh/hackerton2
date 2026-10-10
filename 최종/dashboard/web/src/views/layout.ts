import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import { GROUP_ORDER } from "../format";
import type { Group, REdge, RNode } from "../types";

export const W = 1060;
export const H = 660;
export type Pos = { x: number; y: number };
export type Layout = Map<string, Pos>;

export const radiusOf = (n: RNode): number => 5 + Math.sqrt(n.share ?? 0) * 15;

// Network = four editorial columns (one per group); force only orders nodes vertically
// so strongly linked nodes sit level with each other and labels never collide.
const COL: Record<Group, number> = { attr: 60, beh: 310, watch: 560, outcome: 790 };

interface SimNode extends SimulationNodeDatum {
  id: string;
  group: Group;
  r: number;
}

export function networkLayout(nodes: RNode[], edges: REdge[]): Layout {
  const sim: SimNode[] = nodes.map((n, i) => ({ id: n.id, group: n.group, r: radiusOf(n), x: COL[n.group], y: H / 2 + ((i % 7) - 3) * 40 }));
  const links: (SimulationLinkDatum<SimNode> & { w: number })[] = edges.map((e) => ({ source: e.source, target: e.target, w: Math.abs(e.phi) }));
  forceSimulation(sim)
    .force("link", forceLink<SimNode, SimulationLinkDatum<SimNode> & { w: number }>(links).id((d) => d.id).distance(40).strength((l) => 0.02 + l.w * 0.12))
    .force("x", forceX<SimNode>((d) => COL[d.group]).strength(1))
    .force("y", forceY<SimNode>(H / 2).strength(0.04))
    .force("charge", forceManyBody().strength(-60).distanceMax(120))
    .force("collide", forceCollide<SimNode>((d) => Math.max(d.r, 10) + 17).strength(1))
    .stop()
    .tick(400);
  // Keep the force's vertical order, then enforce a minimum gap per column so labels never touch.
  const out: Layout = new Map();
  for (const g of Object.keys(COL) as Group[]) {
    const col = sim.filter((d) => d.group === g).sort((p, q) => (p.y ?? 0) - (q.y ?? 0));
    const ys: number[] = [];
    col.forEach((d, i) => {
      const prev = col[i - 1];
      const want = d.y ?? 0;
      ys.push(prev ? Math.max(want, (ys[i - 1] ?? 0) + Math.max(prev.r, 9) + Math.max(d.r, 9) + 22) : want);
    });
    const span = (ys[ys.length - 1] ?? 0) - (ys[0] ?? 0);
    const s = span > 0 ? Math.min((H - 90) / span, 1.7) : 1;
    const top = (ys[0] ?? 0) + span / 2;
    col.forEach((d, i) => out.set(d.id, { x: COL[g], y: H / 2 + 12 + ((ys[i] ?? 0) - top) * s }));
  }
  return out;
}

export const CENTER: Pos = { x: W / 2, y: H / 2 };
export const RING = 228;
export const RX = 300; // radial is an ellipse: wider than tall gives bottom labels room

/** Circle ordered by group with a gap between groups; returns angle too for label placement. */
export function radialLayout(nodes: RNode[]): { layout: Layout; angle: Map<string, number>; arcs: { group: Group; a0: number; a1: number }[] } {
  const ordered = GROUP_ORDER.flatMap((g) => nodes.filter((n) => n.group === g));
  const groups = GROUP_ORDER.filter((g) => ordered.some((n) => n.group === g));
  const gap = 0.32;
  const step = (Math.PI * 2 - gap * groups.length) / Math.max(ordered.length, 1);
  const layout: Layout = new Map(), angle = new Map<string, number>();
  const arcs: { group: Group; a0: number; a1: number }[] = [];
  let a = -Math.PI / 2 + gap / 2;
  for (const g of groups) {
    const a0 = a;
    for (const n of ordered.filter((x) => x.group === g)) {
      const t = a + step / 2;
      angle.set(n.id, t);
      layout.set(n.id, { x: CENTER.x + Math.cos(t) * RX, y: CENTER.y + Math.sin(t) * RING });
      a += step;
    }
    arcs.push({ group: g, a0, a1: a });
    a += gap;
  }
  return { layout, angle, arcs };
}

/** Quadratic path. Network: slight bow. Radial: bundled through the centre. */
export function edgePath(p: Pos, q: Pos, mode: "network" | "radial"): string {
  let cx: number, cy: number;
  if (mode === "radial") {
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
    cx = CENTER.x + (mx - CENTER.x) * 0.18;
    cy = CENTER.y + (my - CENTER.y) * 0.18;
  } else {
    const dx = q.x - p.x, dy = q.y - p.y;
    const bow = Math.abs(dx) < 1 ? 0.35 : 0.08;
    cx = (p.x + q.x) / 2 - dy * bow;
    cy = (p.y + q.y) / 2 + dx * bow;
  }
  const r = (v: number) => v.toFixed(1);
  return `M ${r(p.x)} ${r(p.y)} Q ${r(cx)} ${r(cy)} ${r(q.x)} ${r(q.y)}`;
}
