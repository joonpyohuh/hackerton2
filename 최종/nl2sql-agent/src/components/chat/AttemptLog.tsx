import type { Attempt, CheckResult } from "@/lib/agent/contract";
import { CHECK_STATUS_LABEL } from "@/lib/agent/labels";
import { SqlBlock } from "./SqlBlock";

function Check({ name, result }: { name: string; result: CheckResult }) {
  const tone = result.status === "failed" ? "text-accent" : result.status === "passed" ? "text-ink" : "text-mute";
  return (
    <div>
      <span className="label block">{name}</span>
      <span className={`text-[13.5px] ${tone}`}>
        {CHECK_STATUS_LABEL[result.status]}
        {result.score !== null && <span className="tabular-nums"> · {result.score}점</span>}
      </span>
    </div>
  );
}

export function AttemptLog({ attempts }: { attempts: Attempt[] }) {
  return (
    <ol className="space-y-6">
      {attempts.map((a) => {
        const errors = [...a.structural.errors, ...a.semantic.errors, ...a.execution.errors];
        return (
          <li key={a.index} className="border-l border-line pl-5">
            <p className="text-[13.5px] font-medium">시도 {a.index + 1}</p>
            <div className="mt-2 grid grid-cols-3 gap-x-4 max-w-md">
              <Check name="구조" result={a.structural} />
              <Check name="의미" result={a.semantic} />
              <Check name="실행" result={a.execution} />
            </div>
            {errors.length > 0 && (
              <ul className="mt-3 space-y-1 text-[13.5px] text-sub">
                {errors.map((e, i) => (
                  <li key={i}>— {e}</li>
                ))}
              </ul>
            )}
            {a.feedback.length > 0 && (
              <p className="mt-2 text-[13px] text-mute">다음 생성에 전달: {a.feedback.join(" / ")}</p>
            )}
            {a.sql && (
              <details className="mt-3 group">
                <summary className="label cursor-pointer list-none hover:text-ink">
                  <span className="group-open:hidden">SQL 보기 +</span>
                  <span className="hidden group-open:inline">SQL 닫기 −</span>
                </summary>
                <div className="mt-2">
                  <SqlBlock sql={a.sql} />
                </div>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}
