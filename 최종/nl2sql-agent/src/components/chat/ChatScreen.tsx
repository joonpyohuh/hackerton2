"use client";

import { useEffect, useRef } from "react";
import { QuestionForm } from "./QuestionForm";
import { Row } from "./Row";
import { TurnView } from "./TurnView";
import { useAgentStream } from "./useAgentStream";

export function ChatScreen({ mode, examples }: { mode: "mock" | "live"; examples: string[] }) {
  const { turns, running, ask, cancel } = useAgentStream();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col px-5 sm:px-8 md:px-10">
      <header className="grid grid-cols-1 gap-y-1 pb-10 pt-10 md:grid-cols-12 md:gap-x-8">
        <p className="eyebrow text-ink md:col-span-3">NL2SQL Agent</p>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 md:col-span-9">
          <p className="text-[13.5px] text-sub">질문 → SQL 생성 → 구조·의미·실행 검증 → 결과</p>
          {mode === "mock" ? (
            <p className="label text-accent">Mock 모드 · 실제 분석 결과 아님</p>
          ) : (
            <p className="label">실제 데이터 · analytics</p>
          )}
        </div>
      </header>

      <main className="flex-1">
        {turns.length === 0 ? (
          <Row label="예시 질문" strong>
            <ul className="space-y-3">
              {examples.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => ask(q)}
                    disabled={running}
                    className="text-left text-[19px] font-medium leading-[1.5] tracking-[-0.02em] underline-offset-[6px] hover:underline decoration-1"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-8 max-w-[34em] text-[13.5px] leading-[1.75] text-sub">
              {mode === "mock"
                ? "각 예시는 검증 루프의 서로 다른 경로를 보여줍니다. 재시도 후 통과, 정의 확인 요청, 동일 오류 반복에 따른 조기 종료입니다. 표시되는 테이블과 숫자는 가상 데이터입니다."
                : "아래 입력창에 자유롭게 질문할 수 있습니다. 승인된 지표 정의가 없는 질문(유지율·전환율 등)은 임의로 계산하지 않고 기준을 먼저 묻습니다."}
            </p>
          </Row>
        ) : (
          turns.map((t, i) => <TurnView key={t.id} turn={t} index={i} />)
        )}
        <div ref={endRef} />
      </main>

      <div className="sticky bottom-0 -mx-5 bg-paper/95 px-5 pb-6 pt-4 backdrop-blur-sm sm:-mx-8 sm:px-8 md:-mx-10 md:px-10">
        <QuestionForm running={running} onAsk={ask} onCancel={cancel} />
      </div>
    </div>
  );
}
