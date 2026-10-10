import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

const base = process.env.WORKSPACE_URL ?? "https://nl2sql-agent-theta.vercel.app";
type Account = { email: string; password: string };
async function request(path: string, cookie = "", method = "GET", body?: unknown) {
  return fetch(base + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
}
async function login(account: Account) {
  const r = await request("/api/workspace/session", "", "POST", account);
  assert.equal(r.status, 200, "계정 로그인");
  const cookie = r.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "HttpOnly 세션 쿠키");
  assert.match(r.headers.get("set-cookie")!, /HttpOnly/i);
  return cookie;
}
async function main() {
  const owner = JSON.parse(readFileSync(".workspace-owner.local.json", "utf8")) as Account;
  const analyst = await login(owner);
  let account: Account;
  if (existsSync(".workspace-check.local.json")) account = JSON.parse(readFileSync(".workspace-check.local.json", "utf8"));
  else {
    account = { email: "marketer@workspace.local", password: randomBytes(18).toString("base64url") };
    const r = await request("/api/workspace/users", analyst, "POST", { ...account, name: "마케터 체험 계정", role: "marketer" });
    assert.equal(r.status, 201);
    writeFileSync(".workspace-check.local.json", JSON.stringify(account, null, 2), { mode: 0o600 });
  }
  const marketer = await login(account);
  for (const path of ["/api/semantic", "/api/semantic/runs", "/api/workspace/analyses"]) assert.equal((await request(path)).status, 401, "비로그인 차단");
  assert.equal((await request("/api/semantic", marketer, "POST", {})).status, 403, "마케터 직접 정의 쓰기 차단");
  assert.equal((await request("/api/workspace/users", marketer, "POST", {})).status, 403, "역할 승격 차단");
  assert.equal((await fetch(base + "/api/workspace/session", { method: "POST", headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" }, body: JSON.stringify(owner) })).status, 403, "외부 Origin 차단");
  const keywords = await (await request("/api/workspace/keywords", marketer)).json();
  assert.equal(keywords.coverage.start, "2025-02-01");
  assert.ok(keywords.groups.find((g: { id: string }) => g.id === "metric").items.some((i: { enabled: boolean }) => i.enabled));
  const question = "2025년 2월 1일부터 2025년 4월 1일까지 가입한 전체 가입 고객 수를 알려줘.";
  const response = await request("/api/agent", marketer, "POST", { question });
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  const result = events.find((e) => e.type === "final")?.response;
  assert.ok(result, "실제 Harness 최종 응답");
  assert.equal(result.status, "passed", "실제 NL2SQL 검증 통과");
  assert.ok(Object.values(result.table.rows[0]).some((v) => Number(v) === 50000), "실제 DB 가입자 수");
  const id = result.requestId;
  assert.equal((await request(`/api/workspace/analyses/${id}`)).status, 401);
  assert.equal((await request(`/api/workspace/analyses/${id}`, analyst)).status, 404, "검토 전 개인 분석 접근 차단");
  assert.equal((await request(`/api/workspace/analyses/${id}`, marketer, "PATCH", { saved: true, title: "가입 고객 분석 · 협업 확인" })).status, 200);
  const review = `/api/workspace/analyses/${id}/review`;
  assert.equal((await request(review, marketer, "POST", { status: "approved", message: "권한 없이 승인 시도" })).status, 403);
  assert.equal((await request(review, marketer, "POST", { status: "requested", message: "가입 기간과 고유 고객 수를 확인해 주세요." })).status, 200);
  assert.equal((await request(review, analyst, "POST", { status: "in_review", message: "공식 가입 고객 정의와 실제 결과를 확인합니다." })).status, 200);
  assert.equal((await request(review, analyst, "POST", { status: "approved", message: "검증되지 않은 수정 SQL 승인 차단 확인", proposedSql: "SELECT 1" })).status, 400);
  const approval = await request(review, analyst, "POST", { status: "approved", message: "가입일 범위와 COUNT DISTINCT 정의를 확인했으며 원본 데이터 50,000명과 일치합니다." });
  if (approval.status !== 200) console.log("승인 응답:", await approval.text());
  assert.equal(approval.status, 200, "분석가 승인과 RAG 등록");
  const saved = await (await request(`/api/workspace/analyses/${id}`, marketer)).json();
  assert.equal(saved.analysis.review_status, "approved"); assert.equal(saved.analysis.events.length, 3);
  assert.ok(saved.analysis.definitions.some((d: { id: string; version: number }) => d.id === "signup_customers" && d.version > 0), "정의 버전 스냅샷");
  assert.equal((await request(`/api/workspace/analyses/${id}?format=csv`, marketer)).status, 200);
  assert.equal((await request(`/api/workspace/analyses/${id}`, marketer, "PATCH", { shared: true })).status, 200);
  const rag = await (await request("/api/semantic?question=" + encodeURIComponent(question), marketer)).json();
  assert.ok(rag.exampleMatches.some((e: { requestId: string }) => e.requestId === id), "승인된 SQL 사례 검색");
  console.log("운영 확인 통과: 로그인·서버 권한·CSRF·실제 NL2SQL 50,000명·저장·검토·수정 SQL 차단·승인·정의 버전·CSV·내부 공유·RAG 재검색");
  console.log("마케터 계정은 .workspace-check.local.json에 비공개 저장");
  await request("/api/workspace/session", analyst, "DELETE"); await request("/api/workspace/session", marketer, "DELETE");
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : "확인 실패"); process.exitCode = 1; });
