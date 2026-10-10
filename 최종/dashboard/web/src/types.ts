export type Group = "attr" | "beh" | "watch" | "outcome";
export type Population = "all" | "payers";
export type ViewKind = "network" | "radial" | "chart" | "matrix" | "rank";
export type VizKind = "bar" | "donut" | "gauge" | "dots" | "mosaic";

export interface RNode {
  id: string;
  label: string;
  group: Group;
  population: Population;
  count: number;
  population_n: number;
  share: number | null;
  constant: boolean;
}

export interface Table2x2 {
  both: number;
  a_only: number;
  b_only: number;
  neither: number;
}

export interface REdge {
  id: string;
  source: string;
  target: string;
  population: Population;
  n: number;
  table: Table2x2;
  p_a: number;
  p_b: number;
  p_b_given_a: number;
  p_b_given_not_a: number;
  p_a_given_b: number;
  p_a_given_not_b: number;
  lift: number;
  phi: number;
  chi2: number;
  p_value: number;
  min_expected: number;
  strength: "강함" | "보통" | "약함" | "거의 없음";
  caveats: string[];
  diff_pp: number;
  diff_pp_rev: number;
  reliable: boolean;
  significant: boolean;
}

export interface Facts {
  snapshot_id: string;
  dims: { devices: string[]; ages: string[]; base_date: string; max_date: string };
  n: number;
  payers: number;
  nodes: RNode[];
  edges: REdge[];
  tests: number;
  alpha_bonferroni: number;
  skipped_definitional: number;
  method: string;
}

export interface Finding {
  edge_ids: string[];
  title: string;
  fact: string;
  use: string;
  viz: VizKind;
}

export interface Rejected {
  title: string;
  fact: string;
  reason: string;
}

export interface Analysis {
  headline: string;
  recommended_view: ViewKind;
  view_reason: string;
  focus_nodes: string[];
  findings: Finding[];
  rejected: Rejected[];
  snapshot_id: string;
  model: string;
  edges_considered: number;
  elapsed_ms: number;
  created_at: string;
}

export interface Filters {
  from_date: string;
  to_date: string;
  dev: string;
  age: string;
  gen: string;
  push: string;
}

export type Selection =
  | { kind: "edge"; id: string }
  | { kind: "node"; id: string }
  | null;
