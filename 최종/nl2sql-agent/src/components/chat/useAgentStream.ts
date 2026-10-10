"use client";

import { useCallback, useRef, useState } from "react";
import { ZodError } from "zod";
import {
  agentEventSchema,
  type AgentEvent,
  type AgentResponse,
  type Attempt,
  type RunningStage,
} from "@/lib/agent/contract";
import { createNdjsonParser } from "@/lib/agent/ndjson";

export type Turn = {
  id: string;
  question: string;
  stage: RunningStage | null; // null = 대기 또는 종료
  attemptNo: number; // 0부터
  attempts: Attempt[];
  context: Extract<AgentEvent, { type: "context" }> | null;
  response: AgentResponse | null;
  error: string | null;
};

const serverErrorMessage = (body: unknown): string | null =>
  typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : null;

function reduceTurn(turn: Turn, event: AgentEvent): Turn {
  switch (event.type) {
    case "stage":
      return { ...turn, stage: event.stage, attemptNo: event.attempt };
    case "attempt":
      return { ...turn, attempts: [...turn.attempts, event.attempt] };
    case "context":
      return { ...turn, context: event };
    case "final":
      return { ...turn, stage: null, response: event.response, attempts: event.response.attempts };
    case "error":
      return { ...turn, stage: null, error: event.message };
  }
}

export function useAgentStream() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const ask = useCallback(async (question: string) => {
    const id = crypto.randomUUID();
    const update = (fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
    setTurns((ts) => [...ts, { id, question, stage: null, attemptNo: 0, attempts: [], context: null, response: null, error: null }]);
    setRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const message = await res.json().then(serverErrorMessage).catch(() => null);
        throw new Error(message ?? `요청에 실패했습니다. (HTTP ${res.status})`);
      }

      const parser = createNdjsonParser((v) => agentEventSchema.parse(v));
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let finished = false;
      for (;;) {
        const { done, value } = await reader.read();
        const events = done ? parser.flush() : parser.push(value);
        for (const event of events) {
          if (event.type === "final" || event.type === "error") finished = true;
          update((t) => reduceTurn(t, event));
        }
        if (done) break;
      }
      if (!finished) throw new Error("응답이 중간에 끊겼습니다.");
    } catch (e) {
      const message = controller.signal.aborted
        ? "요청을 취소했습니다."
        : e instanceof ZodError
          ? "서버 응답 형식이 계약과 다릅니다."
          : e instanceof SyntaxError
            ? "서버 응답을 해석할 수 없습니다."
            : e instanceof Error
              ? e.message
              : "알 수 없는 오류가 발생했습니다.";
      update((t) => ({ ...t, stage: null, error: message }));
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { turns, running, ask, cancel };
}
