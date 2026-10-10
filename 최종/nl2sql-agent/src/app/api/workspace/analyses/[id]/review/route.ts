import { NextResponse } from "next/server";
import { z } from "zod";
import { reviewSchema } from "@/lib/workspace";
import { getEnv } from "@/server/config/env";
import { currentSchemaVersion } from "@/server/agent/live";
import { requireUser, workspaceError } from "@/server/workspace/access";
import { workspaceStore } from "@/server/workspace/store";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req); if (user instanceof Response) return user;
  try {
    const id = z.uuid().parse((await ctx.params).id);
    const data = reviewSchema.parse(await req.json());
    const schema = data.status === "approved" ? await currentSchemaVersion(getEnv()) : null;
    return NextResponse.json({ analysis: await workspaceStore().review(user, id, data, schema) });
  } catch (e) { return workspaceError(e); }
}
