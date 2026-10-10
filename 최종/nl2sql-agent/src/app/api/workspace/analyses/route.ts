import { NextResponse } from "next/server";
import { requireUser, workspaceError } from "@/server/workspace/access";
import { workspaceStore } from "@/server/workspace/store";
export async function GET(req: Request) {
  const user = await requireUser(req); if (user instanceof Response) return user;
  try { return NextResponse.json({ analyses: await workspaceStore().list(user, new URL(req.url).searchParams.get("view") ?? "recent") }); }
  catch (e) { return workspaceError(e); }
}
