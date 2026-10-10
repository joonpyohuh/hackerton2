import { z } from "zod";
import { NextResponse } from "next/server";
import { getEnv } from "@/server/config/env";
import { getSemanticStore } from "@/server/semantic/store";
import { isAdmin } from "@/server/semantic/admin";

function access(req: Request) {
  const env = getEnv();
  if (!env.DATABASE_URL_APP || !env.SEMANTIC_ADMIN_TOKEN) return { error: NextResponse.json({ error: "관리 기능 설정이 없습니다." }, { status: 503 }) };
  if (!isAdmin(req, env.SEMANTIC_ADMIN_TOKEN)) return { error: NextResponse.json({ error: "관리 토큰이 필요합니다." }, { status: 401 }) };
  return { store: getSemanticStore(env.DATABASE_URL_APP) };
}

export async function GET(req: Request) {
  const auth = access(req);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json({ runs: await auth.store!.runs() });
  } catch {
    return NextResponse.json({ error: "실행 기록을 읽지 못했습니다." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const auth = access(req);
  if (auth.error) return auth.error;
  try {
    const { requestId, approved } = z.object({ requestId: z.uuid(), approved: z.boolean() }).parse(await req.json());
    const changed = await auth.store!.approve(requestId, approved);
    return changed ? NextResponse.json({ requestId, approved }) : NextResponse.json({ error: "승인할 수 있는 통과 기록이 없습니다." }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "승인 상태를 변경하지 못했습니다." }, { status: 400 });
  }
}
