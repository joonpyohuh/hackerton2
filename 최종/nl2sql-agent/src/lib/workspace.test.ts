import { describe, expect, it } from "vitest";
import { canRead, canShare, canTransition, tableCsv, type User } from "./workspace";
import { selectChart } from "./workspaceChart";
import { keywordCatalog } from "@/server/workspace/keywords";
import { SEED_DEFINITIONS, type StoredDefinition } from "@/server/semantic/definitions";
import { passwordHash, verifyPassword } from "@/server/workspace/password";
import type { AgentResponse, ResultTable } from "./agent/contract";
const marketer: User = { id: "m", email: "m@example.com", name: "마케터", role: "marketer" };
const analyst: User = { ...marketer, id: "a", role: "analyst" };
const other = { owner_id: "other", shared: false, review_status: null };
describe("워크스페이스 서버 정책", () => {
  it("다른 구성원의 개인 분석은 역할만으로 읽지 못한다", () => {
    expect(canRead(marketer, other)).toBe(false); expect(canRead(analyst, other)).toBe(false);
    expect(canRead(analyst, { ...other, review_status: "requested" })).toBe(true);
    expect(canRead(marketer, { ...other, shared: true })).toBe(true);
  });
  it("마케터는 요청만 하고 분석가만 검토 상태를 변경한다", () => {
    expect(canTransition(marketer, "m", null, "requested")).toBe(true);
    expect(canTransition(marketer, "other", null, "requested")).toBe(false);
    expect(canTransition(marketer, "m", "requested", "approved")).toBe(false);
    expect(canTransition(analyst, "m", "requested", "in_review")).toBe(true);
    expect(canTransition(analyst, "m", "in_review", "approved")).toBe(true);
    expect(canTransition(analyst, "m", null, "approved")).toBe(false);
    expect(canTransition(marketer, "m", "changes_requested", "requested")).toBe(true);
  });
  it("식별자가 있는 결과는 내부 공유에서도 차단한다", () => {
    const r = { status: "passed", table: { columns: [{ key: "user_key", label: "고객 키" }] } } as unknown as Extract<AgentResponse, { status: "passed" }>;
    expect(canShare(r)).toBe(false);
    expect(canShare({ ...r, table: { ...r.table, columns: [{ key: "n", label: "고객 수", kind: "number" }] } } as AgentResponse)).toBe(true);
  });
  it("CSV는 수식·따옴표·개행을 안전하게 보존한다", () => {
    const table: ResultTable = { columns: [{ key: "label", label: "이름", kind: "text" }], rows: [{ label: " =HYPERLINK(\"bad\")" }, { label: "첫줄\n다음줄" }], rowCount: 2, truncated: false };
    const csv = tableCsv(table); expect(csv).toContain("' =HYPERLINK"); expect(csv).toContain('"첫줄\n다음줄"'); expect(csv).toContain('""bad""');
  });
  it("비밀번호는 평문을 저장하지 않으며 잘못된 입력을 거부한다", async () => {
    const hash = await passwordHash("secure-password-123"); expect(hash).not.toContain("secure-password");
    expect(await verifyPassword("secure-password-123", hash)).toBe(true); expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
describe("데이터 기반 질문과 차트", () => {
  it("공식 정의만 활성화하고 현재 날짜 밖 기간은 막는다", () => {
    const defs = SEED_DEFINITIONS.map((d) => ({ ...d, version: 1 })) as StoredDefinition[];
    const c = keywordCatalog(defs, { start: "2025-02-01", end: "2025-04-01" }, "2025-06-28");
    const metrics = c.groups.find((g) => g.id === "metric")!.items;
    expect(metrics.find((d) => d.id === "signup_customers")?.enabled).toBe(true);
    expect(metrics.find((d) => d.id === "campaign_response_rate")?.enabled).toBe(false);
    expect(c.groups.find((g) => g.id === "period")!.items.find((d) => d.label === "지난달")?.enabled).toBe(false);
    expect(c.recommendations.every((q) => q.includes("2025-02-01"))).toBe(true);
  });
  it("시간 순서가 확인된 결과만 선 그래프로 표시한다", () => {
    const t: ResultTable = { columns: [{ key: "month", label: "월", kind: "text" }, { key: "n", label: "고객 수", kind: "number" }], rows: [{ month: "2025-02", n: 3 }, { month: "2025-03", n: 4 }], rowCount: 2, truncated: false };
    expect(selectChart(t).kind).toBe("line"); expect(selectChart({ ...t, rows: [...t.rows].reverse() }).kind).toBe("bar");
    expect(selectChart({ ...t, rows: [t.rows[0]] }).kind).toBe("kpi");
  });
});
