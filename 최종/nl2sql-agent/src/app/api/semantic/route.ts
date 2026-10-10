import { ZodError, z } from "zod";
import { NextResponse } from "next/server";
import { buildLiveAgent } from "@/server/agent/live";
import { getEnv } from "@/server/config/env";
import { definitionSchema } from "@/server/semantic/definitions";
import { getSemanticStore } from "@/server/semantic/store";
import { requireUser } from "@/server/workspace/access";

const error = (message: string, status: number) => NextResponse.json({ error: message }, { status });
const config = () => {
  const env = getEnv();
  if (!env.DATABASE_URL_APP) throw new Error("정의 저장소가 설정되지 않았습니다.");
  return { env, store: getSemanticStore(env.DATABASE_URL_APP) };
};

export async function GET(req: Request) {
  const user = await requireUser(req); if (user instanceof Response) return user;
  try {
    const { env, store } = config();
    const question = new URL(req.url).searchParams.get("question")?.trim();
    if (!question) return NextResponse.json({ definitions: await store.list(), revision: await store.revision() });
    if (question.length > 500) return error("질문은 500자 이내로 입력하세요.", 400);
    const agent = buildLiveAgent(env);
    if (!agent.ok) return error("검색 서비스를 사용할 수 없습니다.", 503);
    const context = await agent.deps.retriever.retrieve(question, req.signal);
    return NextResponse.json({ question, ...context });
  } catch (e) {
    console.error("[semantic] 정의 검색 실패", e);
    return error("정의 검색에 실패했습니다.", 500);
  }
}

export async function POST(req: Request) {
  const user = await requireUser(req, "analyst"); if (user instanceof Response) return user;
  try {
    const { store } = config();
    const item = definitionSchema.parse(await req.json());
    return NextResponse.json(await store.create(item), { status: 201 });
  } catch (e) {
    if (e instanceof ZodError || e instanceof SyntaxError) return error("정의 형식이 올바르지 않습니다.", 400);
    if ((e as { code?: string }).code === "23505") return error("같은 ID의 정의가 이미 있습니다.", 409);
    return error("정의를 저장하지 못했습니다.", 500);
  }
}

export async function PUT(req: Request) {
  const user = await requireUser(req, "analyst"); if (user instanceof Response) return user;
  try {
    const { store } = config();
    const parsed = z.object({ definition: definitionSchema, version: z.number().int().positive() }).parse(await req.json());
    const updated = await store.update(parsed.definition, parsed.version);
    return updated ? NextResponse.json(updated) : error("정의가 바뀌었거나 존재하지 않습니다. 새로고침 후 다시 편집하세요.", 409);
  } catch (e) {
    if (e instanceof ZodError || e instanceof SyntaxError) return error("정의 형식이 올바르지 않습니다.", 400);
    return error("정의를 수정하지 못했습니다.", 500);
  }
}

export async function DELETE(req: Request) {
  const user = await requireUser(req, "analyst"); if (user instanceof Response) return user;
  try {
    const { store } = config();
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(id)) return error("정의 ID가 올바르지 않습니다.", 400);
    return (await store.delete(id)) ? NextResponse.json({ deleted: id }) : error("정의를 찾을 수 없습니다.", 404);
  } catch {
    return error("정의를 삭제하지 못했습니다.", 500);
  }
}
