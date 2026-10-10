import { z } from "zod";
import { NextResponse } from "next/server";
import { getEnv } from "@/server/config/env";
import { getSemanticStore } from "@/server/semantic/store";

function access() {
  const env = getEnv();
  if (!env.DATABASE_URL_APP) return { error: NextResponse.json({ error: "정의 저장소가 설정되지 않았습니다." }, { status: 503 }) };
  return { store: getSemanticStore(env.DATABASE_URL_APP) };
}

export async function GET() {
  const auth = access();
  if (auth.error) return auth.error;
  try {
    return NextResponse.json({ runs: await auth.store!.runs() });
  } catch {
    return NextResponse.json({ error: "실행 기록을 읽지 못했습니다." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const auth = access();
  if (auth.error) return auth.error;
  try {
    const { requestId, approved } = z.object({ requestId: z.uuid(), approved: z.boolean() }).parse(await req.json());
    const changed = await auth.store!.approve(requestId, approved);
    return changed ? NextResponse.json({ requestId, approved }) : NextResponse.json({ error: "승인할 수 있는 통과 기록이 없습니다. 현재 정의 버전에서 통과했고 후보(비공식) 정의를 쓰지 않은 실행만 승인할 수 있습니다." }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "승인 상태를 변경하지 못했습니다." }, { status: 400 });
  }
}
