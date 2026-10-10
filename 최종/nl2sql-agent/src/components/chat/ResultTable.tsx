import type { Cell, ResultTable as Table } from "@/lib/agent/contract";

const numberFormat = new Intl.NumberFormat("ko-KR");

function formatCell(value: Cell, kind: Table["columns"][number]["kind"]): string {
  if (value === null) return "—";
  if (typeof value === "number") {
    if (kind === "percent") return `${value.toFixed(1)}%`;
    return numberFormat.format(value);
  }
  return String(value);
}

export function ResultTable({ table }: { table: Table }) {
  if (table.rowCount === 0) {
    // 0건은 오류가 아니다 — 조건에 맞는 데이터가 없다는 사실만 전달
    return <p className="text-[14px] text-sub">조건에 맞는 데이터가 없습니다. (0행)</p>;
  }
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px] tracking-[-0.01em]">
          <thead>
            <tr className="border-b border-ink">
              {table.columns.map((c) => (
                <th
                  key={c.key}
                  title={c.key}
                  className={`label py-2 pr-6 font-normal last:pr-0 ${c.kind === "number" || c.kind === "percent" ? "text-right" : "text-left"}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className="border-b border-line">
                {table.columns.map((c) => {
                  const numeric = c.kind === "number" || c.kind === "percent";
                  const value = row[c.key] ?? null;
                  return (
                    <td
                      key={c.key}
                      className={`py-2.5 pr-6 last:pr-0 ${numeric ? "text-right tabular-nums" : "text-left"} ${value === null ? "text-mute" : ""}`}
                    >
                      {formatCell(value, c.kind)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12.5px] text-mute">
        {numberFormat.format(table.rowCount)}행{table.truncated ? " · 행 수 제한으로 일부만 표시" : ""}
      </p>
    </div>
  );
}
