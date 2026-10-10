import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, sessionToken, sameOrigin, workspaceError } from "@/server/workspace/access";
import { workspaceStore } from "@/server/workspace/store";

export async function GET(req: Request) {
  if (!sessionToken(req)) return NextResponse.json({ user: null }, { headers: { "Cache-Control": "no-store" } });
  try { return NextResponse.json({ user: await workspaceStore().user(sessionToken(req)) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return workspaceError(e); }
}
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "허용되지 않은 로그인 요청입니다." }, { status: 403 });
  try {
    const body = await req.json();
    const ip = req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
    const guest = body?.guest === true;
    let session;
    if (guest) session = await workspaceStore().guest(ip);
    else {
      const { email, password } = z.object({ email: z.email().max(200).transform((s) => s.toLowerCase()), password: z.string().min(1).max(200) }).parse(body);
      session = await workspaceStore().login(email, password, ip);
    }
    const { user, token } = session;
    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: new URL(req.url).protocol === "https:", sameSite: "lax", path: "/", maxAge: guest ? 30 * 24 * 3600 : 12 * 3600 });
    return response;
  } catch (e) { return workspaceError(e); }
}
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  try {
    await workspaceStore().logout(sessionToken(req));
    const r = NextResponse.json({ ok: true });
    r.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return r;
  } catch (e) { return workspaceError(e); }
}
