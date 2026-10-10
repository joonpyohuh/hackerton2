import { NextResponse } from "next/server";
import { z } from "zod";
import { tableCsv } from "@/lib/workspace";
import { requireUser, workspaceError } from "@/server/workspace/access";
import { workspaceStore, WorkspaceError } from "@/server/workspace/store";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Context) {
  const user = await requireUser(req); if (user instanceof Response) return user;
  try {
    const id = z.uuid().parse((await ctx.params).id);
    const analysis = await workspaceStore().analysis(user, id);
    if (new URL(req.url).searchParams.get("format") === "csv") {
      if (analysis.response.status !== "passed") throw new WorkspaceError("다운로드할 결과가 없습니다.");
      return new Response(tableCsv(analysis.response.table), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="analysis-${id}.csv"`, "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ analysis }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return workspaceError(e); }
}
export async function PATCH(req: Request, ctx: Context) {
  const user = await requireUser(req); if (user instanceof Response) return user;
  try {
    const id = z.uuid().parse((await ctx.params).id);
    const data = z.object({ title: z.string().trim().min(2).max(150).optional(), saved: z.boolean().optional(), shared: z.boolean().optional() }).parse(await req.json());
    return NextResponse.json({ analysis: await workspaceStore().updateAnalysis(user, id, data) });
  } catch (e) { return workspaceError(e); }
}
