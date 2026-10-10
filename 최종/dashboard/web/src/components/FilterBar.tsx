import type { Facts, Filters } from "../types";

interface Props {
  filters: Filters;
  dims: Facts["dims"] | null;
  loading: boolean;
  onChange: (f: Filters) => void;
  onReset: () => void;
}

const AGE_KO = (a: string): string => ({ UNDER_14: "14세 미만", "70_PLUS": "70+", UNKNOWN: "미상" }[a] ?? a.replace("_", "–"));

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-[14px] text-ink-2">
      <span className="text-[13px] uppercase tracking-[0.08em] text-muted">{label}</span>
      {children}
    </label>
  );
}

/** Same filter semantics (option indices) as the journey dashboard, so both pages agree. */
export function FilterBar({ filters, dims, loading, onChange, onReset }: Props) {
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...filters, [k]: e.target.value });
  return (
    <div className="sticky top-0 z-30 border-b border-hair bg-bg">
      <div className="relative mx-auto flex max-w-[1360px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3.5 sm:px-10">
        <Field label="가입일">
          <input type="date" value={filters.from_date} min={dims?.base_date} max={dims?.max_date} onChange={set("from_date")} />
          <span>—</span>
          <input type="date" value={filters.to_date} min={dims?.base_date} max={dims?.max_date} onChange={set("to_date")} />
        </Field>
        <Field label="기기">
          <select value={filters.dev} onChange={set("dev")}>
            <option value="all">전체</option>
            {dims?.devices.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </Field>
        <Field label="연령">
          <select value={filters.age} onChange={set("age")}>
            <option value="all">전체</option>
            {dims?.ages.map((a, i) => <option key={a} value={i}>{AGE_KO(a)}</option>)}
          </select>
        </Field>
        <Field label="성별">
          <select value={filters.gen} onChange={set("gen")}>
            <option value="all">전체</option><option value="0">0</option><option value="1">1</option><option value="2">2</option>
          </select>
        </Field>
        <Field label="푸시 알림">
          <select value={filters.push} onChange={set("push")}>
            <option value="all">전체</option><option value="1">받음</option><option value="0">안 받음</option>
          </select>
        </Field>
        <button type="button" onClick={onReset} className="ml-auto cursor-pointer text-[14px] text-muted underline underline-offset-[3px] hover:text-ink">초기화</button>
        {loading && <span className="absolute inset-x-0 bottom-[-1px] h-px overflow-hidden"><span className="block h-full w-1/3 animate-[slide_1s_ease-in-out_infinite] bg-accent" /></span>}
      </div>
    </div>
  );
}
