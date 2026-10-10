import type { ResultTable } from "./agent/contract";
export function selectChart(table: ResultTable) {
  const columns = table.columns.filter((c) => (c.kind === "number" || c.kind === "percent") && table.rows.every((r) => r[c.key] !== null && Number.isFinite(Number(r[c.key]))));
  if (table.rows.length === 1 && columns.length) return { kind: "kpi" as const, columns };
  const label = table.columns.find((c) => c.kind === "text" || c.kind === "date");
  const value = columns[0];
  if (label && value && table.rows.length > 1) {
    if (table.rows.some((r) => Number(r[value.key]) < 0)) return { kind: "table" as const };
    const dates = table.rows.map((r) => String(r[label.key]));
    const chronological = dates.every((d, i) => /^\d{4}-\d{2}(?:-\d{2})?$/.test(d) && (i === 0 || dates[i - 1] < d));
    if (chronological && table.rows.length <= 60) return { kind: "line" as const, label, value };
    return { kind: "bar" as const, label, value };
  }
  return { kind: "table" as const };
}
