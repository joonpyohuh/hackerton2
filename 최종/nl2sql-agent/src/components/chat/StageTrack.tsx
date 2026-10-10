import type { CheckResult } from "@/lib/agent/contract";
import { FINAL_STATUS_LABEL, PIPELINE_STEPS, STAGE_STATUS_LABEL } from "@/lib/agent/labels";
import type { Turn } from "./useAgentStream";

type StepState = "done" | "active" | "failed" | "pending";

const STEP_STYLE: Record<StepState, string> = {
  done: "border-ink text-ink",
  active: "border-accent text-accent",
  failed: "border-accent text-accent",
  pending: "border-line text-mute",
};

const fromCheck = (c: CheckResult | undefined): StepState =>
  c?.status === "passed" ? "done" : c?.status === "failed" ? "failed" : "pending";

/** 진행 중에는 현재 단계를, 종료 후에는 마지막 시도의 단계별 결과를 보여준다. */
function stepStates(turn: Turn): StepState[] {
  if (turn.stage) {
    const current = PIPELINE_STEPS.findIndex((s) => s.stage === turn.stage);
    if (current === -1) return PIPELINE_STEPS.map((_, i) => (i <= 1 ? "done" : "pending")); // correcting
    return PIPELINE_STEPS.map((_, i) => (i < current ? "done" : i === current ? "active" : "pending"));
  }
  const last = turn.attempts.at(-1);
  const resolved = turn.resolution?.status === "resolved" || turn.resolution?.status === "no_metric";
  return [
    // 지표 해석에서 멈춘 경우(정의 없음·모호·계산 불가)는 실패가 아니라 확인 요청이므로 강조색으로만 표시한다.
    turn.resolution ? (resolved ? "done" : "active") : turn.response ? "done" : "pending",
    turn.context || turn.attempts.length ? "done" : "pending",
    last?.sql ? "done" : "pending",
    fromCheck(last?.structural),
    fromCheck(last?.semantic),
    fromCheck(last?.execution),
  ];
}

export function StageTrack({ turn }: { turn: Turn }) {
  const states = stepStates(turn);
  const response = turn.response;

  return (
    <div>
      <ol className="grid grid-cols-6 gap-x-2 sm:gap-x-3">
        {PIPELINE_STEPS.map((step, i) => (
          <li key={step.stage} className={`border-t-2 pt-2 transition-colors duration-300 ${STEP_STYLE[states[i]]}`}>
            <span className="block font-mono text-[10.5px] tracking-[0.08em] opacity-70">0{i + 1}</span>
            <span className="block text-[12.5px] leading-snug tracking-[-0.015em] sm:text-[13px]">{step.label}</span>
          </li>
        ))}
      </ol>

      <p className="mt-4 flex items-center gap-2 text-[13.5px] tracking-[-0.01em]">
        {turn.stage ? (
          <>
            <span className="pulse-dot inline-block size-1.5 rounded-full bg-accent" aria-hidden />
            <span className="text-accent">{STAGE_STATUS_LABEL[turn.stage]}</span>
            <span className="text-mute">· 시도 {turn.attemptNo + 1}</span>
          </>
        ) : response ? (
          <>
            <span className={response.status === "passed" ? "text-ink font-medium" : "text-accent font-medium"}>
              {FINAL_STATUS_LABEL[response.status]}
            </span>
            <span className="text-mute">
              · {turn.attempts.length > 0 ? `시도 ${turn.attempts.length}회` : "SQL 생성 전 확인 요청"} ·{" "}
              {(response.durationMs / 1000).toFixed(1)}초
            </span>
          </>
        ) : turn.error ? (
          <span className="text-accent">중단됨</span>
        ) : (
          <span className="text-mute">대기 중</span>
        )}
      </p>
    </div>
  );
}
