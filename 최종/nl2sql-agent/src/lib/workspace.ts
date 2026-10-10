import { z } from "zod";
import type { AgentResponse, ResultTable } from "./agent/contract";
import type { StoredDefinition } from "@/server/semantic/definitions";

export type User = { id: string; email: string; name: string; role: "marketer" | "analyst" };
export const reviewStatusSchema = z.enum(["requested", "in_review", "changes_requested", "approved", "rejected"]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  requested: "검토 요청", in_review: "검토 중", changes_requested: "수정 요청", approved: "승인 완료", rejected: "검토 반려",
};
export type ReviewEvent = { id: string; status: ReviewStatus; message: string; proposed_sql: string | null; actor_name: string; created_at: string };
export type Analysis = {
  id: string; owner_id: string; owner_name: string; title: string; response: AgentResponse;
  definitions: StoredDefinition[]; saved: boolean; shared: boolean; review_status: ReviewStatus | null;
  created_at: string; schema_version: string | null; events?: ReviewEvent[];
};
export const accountSchema = z.object({ email: z.email().max(200).transform((s) => s.toLowerCase()), name: z.string().trim().min(2).max(60), password: z.string().min(12).max(200), role: z.enum(["marketer", "analyst"]) });
export const reviewSchema = z.object({ status: reviewStatusSchema, message: z.string().trim().min(2).max(3000), proposedSql: z.string().max(15000).nullable().default(null) });

export function canRead(user: User, analysis: Pick<Analysis, "owner_id" | "shared" | "review_status">) {
  return user.id === analysis.owner_id || analysis.shared || (user.role === "analyst" && analysis.review_status !== null);
}
export function canTransition(user: User, owner: string, from: ReviewStatus | null, to: ReviewStatus) {
  if (to === "requested") return user.id === owner && (from === null || from === "changes_requested" || from === "rejected");
  return user.role === "analyst" && from !== null && (from === "requested" || from === "in_review") && ["in_review", "changes_requested", "approved", "rejected"].includes(to) && to !== from;
}
export function canShare(response: AgentResponse) {
  return response.status === "passed" && !response.table.columns.some((c) => /(?:user|customer|payment)_key|email|phone|전화|이메일|고객.*(?:id|키)/i.test(`${c.key} ${c.label}`));
}
export function tableCsv(table: ResultTable) {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(s) && typeof v !== "number") s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [table.columns.map((c) => cell(c.label)).join(","), ...table.rows.map((r) => table.columns.map((c) => cell(r[c.key])).join(","))].join("\r\n");
}
export type Keyword = { id: string; label: string; enabled: boolean; reason: string; definitionId?: string };
export type KeywordCatalog = { groups: { id: string; label: string; items: Keyword[] }[]; recommendations: string[]; coverage: { start: string; end: string }; connected: boolean; latestObservation: string; definitions: number };
