import type { ResultTable } from "@/lib/agent/contract";
import type { ExecutionOutput, ResultFormatter } from "./types";

/**
 * 결정론적 결과 설명기. 답변 문장의 숫자는 실행 결과에서만 가져온다 (LLM이 숫자를 만들지 않음).
 * 제목·표시명은 생성 모델이 붙인 한국어 라벨을 쓰되, 없으면 실제 컬럼명을 그대로 보여준다.
 */

type Kind = ResultTable["columns"][number]["kind"];
const NUMERIC = new Set(["int2", "int4", "int8", "numeric", "float4", "float8"]);
const DATE = new Set(["date", "timestamp", "timestamptz"]);
const kindOf = (dataType: string): Kind => (NUMERIC.has(dataType) ? "number" : DATE.has(dataType) ? "date" : "text");

const numberFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
const display = (v: ExecutionOutput["rows"][number][string]) =>
  v === null ? "값 없음" : typeof v === "number" ? numberFormat.format(v) : String(v);

export function createTemplateFormatter(): ResultFormatter {
  return {
    async format({ execution, generation, question, context }) {
      const labels = generation.columnLabels;
      const columns = execution.columns.map((c) => ({ key: c.name, label: labels[c.name] ?? c.name, kind: kindOf(c.dataType) }));
      const metric = (context.definitions ?? []).filter((d) => d.kind === "metric" && generation.definition.metricIds.includes(d.id));
      const numeric = columns.filter((c) => c.kind === "number");
      if (metric.length === 1 && metric[0].unit === "%" && numeric.length === 1) numeric[0].kind = "percent";
      const title = generation.title.trim() || question;

      let answer: string;
      if (execution.rowCount === 0) {
        answer = `${title}: 조건에 맞는 데이터가 없습니다.`;
      } else if (execution.rowCount === 1 && columns.length === 1) {
        const c = columns[0];
        const value = execution.rows[0][c.key] ?? null;
        // 단위는 모델이 아니라 적용한 정의에서 가져온다 (예: 비율 지표의 %).
        const unit = (context.definitions ?? []).find((d) => d.kind === "metric" && generation.definition.metricIds.includes(d.id))?.unit;
        answer = `${title}: ${display(value)}${unit === "%" && typeof value === "number" ? "%" : ""}`;
      } else if (execution.rowCount === 1) {
        answer = `${title}: ` + columns.map((c) => `${c.label} ${display(execution.rows[0][c.key] ?? null)}`).join(", ");
      } else {
        answer = `${title} — ${numberFormat.format(execution.rowCount)}행을 조회했습니다.${execution.truncated ? " (행 수 제한으로 일부만 표시)" : ""}`;
      }

      return {
        answer,
        table: { columns, rows: execution.rows, rowCount: execution.rowCount, truncated: execution.truncated },
        metrics: generation.usedMetrics,
        period: generation.period,
        assumptions: generation.assumptions,
        usage: null,
      };
    },
  };
}
