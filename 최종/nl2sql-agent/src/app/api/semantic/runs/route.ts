import { z } from "zod";
import { NextResponse } from "next/server";
import { getEnv } from "@/server/config/env";
import { getSemanticStore } from "@/server/semantic/store";
import { requireUser } from "@/server/workspace/access";
import { currentSchemaVersion } from "@/server/agent/live";
import { workspaceStore } from "@/server/workspace/store";
import { workspaceError } from "@/server/workspace/access";

function access() {
  const env = getEnv();
  if (!env.DATABASE_URL_APP) return { error: NextResponse.json({ error: "정의 저장소가 설정되지 않았습니다." }, { status: 503 }) };
  return { store: getSemanticStore(env.DATABASE_URL_APP) };
}

export async function GET(req: Request) {
  const user = await requireUser(req, "analyst"); if (user instanceof Response) return user;
  const auth = access();
  if (auth.error) return auth.error;
  try {
    return NextResponse.json({ runs: await auth.store!.runs() });
  } catch {
    return NextResponse.json({ error: "실행 기록을 읽지 못했습니다." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const user = await requireUser(req, "analyst"); if (user instanceof Response) return user;
  const auth = access();
  if (auth.error) return auth.error;
  try {
    const { requestId, approved } = z.object({ requestId: z.uuid(), approved: z.boolean() }).parse(await req.json());
    if (!approved) return NextResponse.json({ error: "검토 요청 화면에서 검토 의견과 함께 상태를 변경해 주세요." }, { status: 409 });
    await workspaceStore().review(user, requestId, { status: "approved", message: "분석가가 원본 SQL과 공식 지표를 검토하고 사례 등록을 승인했습니다.", proposedSql: null }, await currentSchemaVersion(getEnv()));
    return NextResponse.json({ requestId, approved });
  } catch (e) {
    return workspaceError(e);
  }
}
