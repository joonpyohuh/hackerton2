import type { Resolution } from "@/lib/agent/contract";
import { RESOLUTION_STATUS_LABEL } from "@/lib/agent/labels";

/** Semantic Resolver 판정을 그대로 보여준다. 무엇을 어떤 정의로 계산하는지 사용자가 확인할 수 있게 한다. */
export function ResolutionView({ resolution, names }: { resolution: Resolution; names: Map<string, string> }) {
  const r = resolution;
  const candidates = new Set(r.candidateIds);
  const named = (ids: string[]) =>
    ids.map((id) => `${names.get(id) ? `${names.get(id)} (${id})` : id}${candidates.has(id) ? " · 후보 정의" : ""}`).join(", ");
  const items: [string, string][] = [
    ["판정", RESOLUTION_STATUS_LABEL[r.status]],
    ["요청 지표", r.requestedMetric ?? "—"],
    ["적용 지표", r.metricIds.length ? named(r.metricIds) : "—"],
    ["기간", r.period ?? "—"],
    ["집계 단위", r.grain ?? "—"],
    ["차원·용어", r.supportIds.length ? named(r.supportIds) : "—"],
  ];
  const lists: [string, string[]][] = [
    ["적용 필터", r.filters],
    ["이전 대화에서 확정한 조건", r.confirmed],
    ["정의 기본값을 적용한 조건", r.unspecified],
  ];

  return (
    <div>
      {r.standaloneQuestion && (
        <p className="text-[14px] leading-[1.65] text-sub">
          <span className="text-mute">해석한 질문 </span>
          {r.standaloneQuestion}
        </p>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt className="label">{k}</dt>
            <dd className="mt-0.5 text-[14px] leading-snug">{v}</dd>
          </div>
        ))}
      </dl>
      {r.concepts.length > 0 && (
        <div className="mt-5">
          <p className="label">개념별 대응 정의</p>
          <ul className="mt-1 space-y-0.5 text-[13.5px] text-sub">
            {r.concepts.map((c) => (
              <li key={c.phrase}>
                — {c.phrase} → {c.ids.length ? named(c.ids) : <span className="text-accent">대응 정의 없음</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.candidateIds.length > 0 && (
        <p className="mt-5 text-[13px] leading-[1.6] text-accent">
          공식 정의가 없는 개념은 데이터로 계산 가능한 후보 정의를 적용했습니다. 공식 지표가 아니며 확정 지식으로 저장되지 않습니다.
        </p>
      )}
      {lists
        .filter(([, values]) => values.length > 0)
        .map(([k, values]) => (
          <div key={k} className="mt-5">
            <p className="label">{k}</p>
            <ul className="mt-1 space-y-0.5 text-[13.5px] text-sub">
              {values.map((v) => (
                <li key={v}>— {v}</li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
