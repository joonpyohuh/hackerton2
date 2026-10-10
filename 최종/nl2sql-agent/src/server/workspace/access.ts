import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { User } from "@/lib/workspace";
import { WorkspaceError, workspaceStore } from "./store";

export const SESSION_COOKIE = "mi_session";
export function sessionToken(req: Request) {
  return req.headers.get("cookie")?.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) ?? "";
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return !origin || origin === new URL(req.url).origin;
}
export async function requireUser(req: Request, role?: User["role"]): Promise<User | Response> {
  if (req.method !== "GET" && !sameOrigin(req)) return NextResponse.json({ error: "이 사이트에서 요청을 다시 보내 주세요." }, { status: 403 });
  try {
    const token = sessionToken(req);
    if (!token) return NextResponse.json({ error: "로그인 후 사용할 수 있습니다." }, { status: 401 });
    const user = await workspaceStore().user(token);
    if (!user) return NextResponse.json({ error: "로그인 후 사용할 수 있습니다." }, { status: 401 });
    if (role && user.role !== role) return NextResponse.json({ error: "분석가 권한이 필요합니다." }, { status: 403 });
    return user;
  } catch (e) { return workspaceError(e); }
}
export function workspaceError(e: unknown) {
  if (e instanceof WorkspaceError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ZodError || e instanceof SyntaxError) return NextResponse.json({ error: "입력 내용을 확인해 주세요." }, { status: 400 });
  if ((e as { code?: string })?.code === "23505") return NextResponse.json({ error: "이미 등록된 항목입니다." }, { status: 409 });
  console.error("[workspace]", e instanceof Error ? e.name : "unknown");
  return NextResponse.json({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
}
