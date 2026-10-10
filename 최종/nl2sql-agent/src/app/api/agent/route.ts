import { NextResponse } from "next/server";
import { agentRequestSchema, type AgentEvent } from "@/lib/agent/contract";
import { encodeNdjson } from "@/lib/agent/ndjson";
import { buildLiveAgent } from "@/server/agent/live";
import { runAgentPipeline } from "@/server/agent/pipeline";
import { EnvConfigError, getEnv } from "@/server/config/env";
import { runMockAgent } from "@/server/mock/mockAgent";
import { requireUser } from "@/server/workspace/access";
import { workspaceStore } from "@/server/workspace/store";
import type { User } from "@/lib/workspace";

// 생성·검증 LLM 호출이 재시도마다 반복되므로 서버리스 함수 실행 시간을 넉넉히 둔다.
export const maxDuration = 300;

const errorJson =(message: string, status: number) => NextResponse.json({ error: message }, { status });

function streamEvents(events: AsyncGenerator<AgentEvent>, signal: AbortSignal, user?: User): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => controller.enqueue(encoder.encode(encodeNdjson(event)));
      try {
        for await (const event of events) {
          if (event.type === "final" && user) {
            try { await workspaceStore().saveAnalysis(user, event.response); }
            catch { send({ type: "error", message: "분석은 완료했지만 기록 저장에 실패했습니다. 저장·공유를 위해 다시 실행해 주세요." }); }
          }
          send(event);
        }
      } catch {
        if (!signal.aborted) send({ type: "error", message: "에이전트 실행 중 오류가 발생했습니다." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  const user = await requireUser(req); if (user instanceof Response) return user;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("요청 본문이 올바른 JSON이 아닙니다.", 400);
  }
  const parsed = agentRequestSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "잘못된 요청입니다.", 400);
  const { question, history } = parsed.data;

  let env;
  try {
    env = getEnv();
  } catch (e) {
    return errorJson(e instanceof EnvConfigError ? e.message : "서버 설정 오류", 500);
  }

  if (env.AGENT_MODE === "mock") return streamEvents(runMockAgent(question, { signal: req.signal }), req.signal);

  const live = buildLiveAgent(env);
  if (!live.ok) return errorJson(`live 모드를 실행할 수 없습니다. 준비되지 않은 항목: ${live.missing.join(", ")}`, 501);
  return streamEvents(runAgentPipeline(question, live.deps, live.config, req.signal, history), req.signal, user);
}
