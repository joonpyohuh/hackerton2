import type { ReactNode } from "react";

/** 12단 그리드의 기본 행: 왼쪽 3단 라벨 / 오른쪽 9단 본문. strong = 묶음의 시작을 알리는 진한 상단선 */
export function Row({ label, children, strong = false }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <section
      className={`grid grid-cols-1 gap-y-3 border-t py-7 md:grid-cols-12 md:gap-x-8 ${strong ? "border-ink" : "border-line"}`}
    >
      <div className="label md:col-span-3 md:pt-[3px]">{label}</div>
      <div className="min-w-0 md:col-span-9">{children}</div>
    </section>
  );
}
