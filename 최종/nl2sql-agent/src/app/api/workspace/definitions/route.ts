import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, workspaceError } from "@/server/workspace/access";
import { workspaceStore } from "@/server/workspace/store";
import { definitionSchema } from "@/server/semantic/definitions";
export async function GET(req: Request) {
  const user = await requireUser(req); if (user instanceof Response) return user;
  try { return NextResponse.json({ changes: await workspaceStore().definitionChanges(user) }); } catch (e) { return workspaceError(e); }
}
export async function POST(req: Request) {
  const user = await requireUser(req); if (user instanceof Response) return user;
  try {
    const data = z.object({ definition: definitionSchema, version: z.number().int().positive(), reason: z.string().trim().min(5).max(2000) }).parse(await req.json());
    await workspaceStore().proposeDefinition(user, data.definition, data.version, data.reason);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) { return workspaceError(e); }
}
export async function PATCH(req: Request) {
  const user = await requireUser(req, "analyst"); if (user instanceof Response) return user;
  try {
    const data = z.object({ id: z.uuid(), approved: z.boolean(), note: z.string().trim().min(5).max(2000) }).parse(await req.json());
    await workspaceStore().reviewDefinition(user, data.id, data.approved, data.note);
    return NextResponse.json({ ok: true });
  } catch (e) { return workspaceError(e); }
}
