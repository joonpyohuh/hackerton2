import type { AgentResponse } from "@/lib/agent/contract";
import { GROUND_TRUTH_LABEL } from "@/lib/agent/labels";
import { AttemptLog } from "./AttemptLog";
import { ResultTable } from "./ResultTable";
import { Row } from "./Row";
import { SqlBlock } from "./SqlBlock";
import { StageTrack } from "./StageTrack";
import type { Turn } from "./useAgentStream";

type Passed = Extract<AgentResponse, { status: "passed" }>;

function Meta({ r }: { r: Passed }) {
  const items: [string, string][] = [
    ["사용 지표", r.meta.metrics.join(", ") || "—"],
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

export function TurnView({ turn, index }: { turn: Turn; index: number }) {
  const r = turn.response;
  const initialSql = turn.attempts[0]?.sql;

  return (
    <article className="pb-10">
      <Row label={`질문 ${String(index + 1).padStart(2, "0")}`} strong>
        <h2 className="text-[24px] font-semibold leading-[1.4] tracking-[-0.025em] sm:text-[26px]">{turn.question}</h2>
      </Row>

      <Row label="진행">
        <StageTrack turn={turn} />
      </Row>

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
          <p className="text-[17px] font-medium leading-[1.65] tracking-[-0.02em]">{r.clarificationQuestion}</p>
          {r.missingDefinitions.length > 0 && (
            <ul className="mt-4 space-y-1 text-[14px] text-sub">
              {r.missingDefinitions.map((d) => (
                <li key={d}>— {d}</li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-[13px] text-mute">정의되지 않은 지표는 임의로 계산하지 않습니다.</p>
        </Row>
      )}

      {r?.status === "failed" && (
        <Row label="실패 사유">
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
