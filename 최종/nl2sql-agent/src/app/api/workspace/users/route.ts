import { NextResponse } from "next/server";
import { accountSchema } from "@/lib/workspace";
import { requireUser, workspaceError } from "@/server/workspace/access";
import { workspaceStore } from "@/server/workspace/store";
export async function GET(req: Request) {
  const user = await requireUser(req, "analyst"); if (user instanceof Response) return user;
  try { return NextResponse.json({ users: await workspaceStore().users(user) }); } catch (e) { return workspaceError(e); }
}
export async function POST(req: Request) {
  const user = await requireUser(req, "analyst"); if (user instanceof Response) return user;
  try { return NextResponse.json(await workspaceStore().createUser(user, accountSchema.parse(await req.json())), { status: 201 }); } catch (e) { return workspaceError(e); }
}
