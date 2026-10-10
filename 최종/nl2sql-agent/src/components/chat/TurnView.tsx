import type { AgentResponse } from "@/lib/agent/contract";
import { GROUND_TRUTH_LABEL, ISSUE_TYPE_LABEL } from "@/lib/agent/labels";
import { AttemptLog } from "./AttemptLog";
import { ResolutionView } from "./ResolutionView";
import { ResultTable } from "./ResultTable";
import { Row } from "./Row";
import { SqlBlock } from "./SqlBlock";
import { StageTrack } from "./StageTrack";
import type { Turn } from "./useAgentStream";

type Passed = Extract<AgentResponse, { status: "passed" }>;

function Meta({ r }: { r: Passed }) {
  const d = r.meta.definition;
  const items: [string, string][] = [
    ["사용 지표", r.meta.metrics.join(", ") || "—"],
    ...(d
      ? ([
          ["지표 ID", d.metricIds.map((id) => (d.candidateIds.includes(id) ? `${id} (후보 정의)` : id)).join(", ") || "—"],
          ["참조 정의", d.definitionRefs.join(", ") || "—"],
          ["집계 단위", d.grain ?? "—"],
        ] as [string, string][])
      : []),
    ["적용 기간", r.meta.period ?? "—"],
    ["의미 검증", `통과 · ${r.meta.semanticScore}점`],
    ["정답 검증", GROUND_TRUTH_LABEL[r.meta.groundTruth]],
    ["SQL 수정", `${Math.max(r.attempts.length - 1, 0)}회`],
    ["데이터 출처", r.meta.sources.join(", ") || "—"],
  ];
  return (
    <>
      <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt className="label">{k}</dt>
            <dd className="mt-0.5 text-[14px] leading-snug">{v}</dd>
          </div>
        ))}
      </dl>
      {d?.formula && (
        <div className="mt-5">
          <p className="label">실제 계산식</p>
          <p className="mt-1 text-[13.5px] leading-[1.65] text-sub">{d.formula}</p>
        </div>
      )}
      {d && d.filters.length > 0 && (
        <div className="mt-5">
          <p className="label">적용한 필터</p>
          <ul className="mt-1 space-y-0.5 text-[13.5px] text-sub">
            {d.filters.map((f) => (
              <li key={f}>— {f}</li>
            ))}
          </ul>
        </div>
      )}
      {r.meta.assumptions.length > 0 && (
        <div className="mt-5">
          <p className="label">적용한 가정</p>
          <ul className="mt-1 space-y-0.5 text-[13.5px] text-sub">
            {r.meta.assumptions.map((a) => (
              <li key={a}>— {a}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export function TurnView({ turn, index, onAsk }: { turn: Turn; index: number; onAsk?: (question: string) => void }) {
  const r = turn.response;
  const initialSql = turn.attempts[0]?.sql;
  const resolution = r?.resolution ?? turn.resolution;
  const names = new Map((turn.context?.matches ?? []).map((m) => [m.id, m.name]));

  return (
    <article className="pb-10">
      <Row label={`질문 ${String(index + 1).padStart(2, "0")}`} strong>
        <h2 className="text-[24px] font-semibold leading-[1.4] tracking-[-0.025em] sm:text-[26px]">{turn.question}</h2>
      </Row>

      <Row label="진행">
        <StageTrack turn={turn} />
      </Row>

      {resolution && (
        <Row label="지표 해석">
          <ResolutionView resolution={resolution} names={names} />
        </Row>
      )}

      {turn.context && (
        <Row label="검색 Context">
          <p className="text-[13.5px] text-sub">
            {turn.context.matches.length
              ? turn.context.matches
                  .map((m) => `${m.name} (${m.via === "resolver" ? "의미 판정" : "표현 일치"} · 관련도 ${m.score})`)
                  .join(" · ")
              : "일치하는 업무 정의 없음 · 원천 컬럼만 조회"}
            {turn.context.exampleMatches.length > 0 && ` · 승인 사례 ${turn.context.exampleMatches.length}건`}
          </p>
          <details className="mt-2 text-[13px] text-sub">
            <summary className="cursor-pointer">Agent에 전달한 정의·스키마 보기</summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded border border-line bg-surface p-3 text-[12px]">
              {`정의\n${turn.context.semantic || "(없음)"}\n\n스키마\n${turn.context.schema}\n\n승인 사례\n${turn.context.examples || "(없음)"}`}
            </pre>
          </details>
          {(turn.context.concepts?.length ?? 0) > 0 && (
            <ul className="mt-2 space-y-0.5 text-[13px] text-sub">
              {turn.context.concepts!.map((c) => (
                <li key={c.phrase}>
                  — 개념 “{c.phrase}” → {c.ids.length ? c.ids.map((id) => names.get(id) ?? id).join(", ") : "대응 정의 없음"}
                  {c.synonyms.length > 0 && <span className="text-mute"> · 동의어 검색 후보 {c.synonyms.join(", ")}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[12.5px] text-mute">관련도는 검색 휴리스틱입니다. 정답률을 뜻하지 않습니다.</p>
        </Row>
      )}

      {r?.status === "passed" && (
        <>
          <Row label="답변">
            <p className="text-[19px] font-medium leading-[1.6] tracking-[-0.02em]">{r.answer}</p>
            {r.isMock && <p className="mt-2 text-[12.5px] text-accent">Mock 데이터 — 실제 분석 결과가 아닙니다.</p>}
            <Meta r={r} />
          </Row>
          <Row label="결과">
            <ResultTable table={r.table} />
          </Row>
          <Row label="최종 SQL">
            <SqlBlock sql={r.sql} />
            {initialSql && initialSql !== r.sql && (
              <p className="mt-3 text-[13px] text-mute">최초 생성 SQL은 아래 검증 로그의 시도 1에서 확인할 수 있습니다.</p>
            )}
          </Row>
        </>
      )}

      {r?.status === "needs_clarification" && (
        <Row label="확인 필요">
          {r.issueType && <p className="label mb-2 text-accent">{ISSUE_TYPE_LABEL[r.issueType]}</p>}
          <p className="text-[17px] font-medium leading-[1.65] tracking-[-0.02em]">{r.clarificationQuestion}</p>
          {r.missingDefinitions.length > 0 && (
            <ul className="mt-4 space-y-1 text-[14px] text-sub">
              {r.missingDefinitions.map((d) => (
                <li key={d}>— 공식 정의 없음: {d}</li>
              ))}
            </ul>
          )}
          {onAsk && (r.resolution?.options.length ?? 0) > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {r.resolution!.options.map((o, i) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => onAsk(`${o.label} 기준으로 계산해줘`)}
                  className="rounded-sm border border-line px-3 py-1.5 text-left text-[14px] leading-snug tracking-[-0.015em] transition-colors duration-200 hover:border-ink focus-visible:border-accent focus-visible:outline-none"
                >
                  <span className="mr-1.5 font-mono text-[11px] text-mute">{String(i + 1).padStart(2, "0")}</span>
                  {o.label}
                </button>
              ))}
            </div>
          )}
          <p className="mt-4 text-[13px] text-mute">정의되지 않은 지표는 임의로 계산하지 않습니다.</p>
        </Row>
      )}

      {r?.status === "failed" && (
        <Row label="실패 사유">
          {r.issueType && <p className="label mb-2 text-accent">{ISSUE_TYPE_LABEL[r.issueType]}</p>}
          <p className="text-[17px] font-medium leading-[1.65] tracking-[-0.02em]">{r.message}</p>
          <ul className="mt-4 space-y-1 text-[14px] text-sub">
            {r.reasons.map((reason) => (
              <li key={reason}>— {reason}</li>
            ))}
          </ul>
        </Row>
      )}

      {turn.error && (
        <Row label="오류">
          <p className="text-[15px] text-accent">{turn.error}</p>
        </Row>
      )}

      {turn.attempts.length > 0 && (
        <Row label="검증 로그">
          <AttemptLog attempts={turn.attempts} />
        </Row>
      )}
    </article>
  );
}
