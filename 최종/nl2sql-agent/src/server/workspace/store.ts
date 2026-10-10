import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getSemanticPool } from "@/server/semantic/store";
import { getEnv } from "@/server/config/env";
import { canRead, canShare, canTransition, type Analysis, type User, type ReviewStatus } from "@/lib/workspace";
import type { AgentResponse } from "@/lib/agent/contract";
import { definitionSchema } from "@/server/semantic/definitions";
import { passwordHash, tokenHash, verifyPassword } from "./password";

export class WorkspaceError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
export class WorkspaceStore {
  constructor(public readonly pool: Pool) {}
  async user(token: string): Promise<User | null> {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const r = await this.pool.query<User>("SELECT u.id,u.email,u.name,u.role FROM workspace.sessions s JOIN workspace.users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now()", [tokenHash(token)]);
    return r.rows[0] ?? null;
  }
  async login(email: string, password: string, ip: string) {
    const key = tokenHash(`${ip}|${email}`);
    const ipKey = tokenHash(`ip|${ip}`);
    for (const k of [key, ipKey]) {
      const r = await this.pool.query<{ attempts: number }>(`INSERT INTO workspace.login_attempts(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN workspace.login_attempts.started_at<now()-interval '15 minutes' THEN 1 ELSE workspace.login_attempts.attempts+1 END, started_at=CASE WHEN workspace.login_attempts.started_at<now()-interval '15 minutes' THEN now() ELSE workspace.login_attempts.started_at END RETURNING attempts`, [k]);
      if (r.rows[0].attempts > (k === key ? 10 : 60)) throw new WorkspaceError("로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.", 429);
    }
    const r = await this.pool.query<User & { password_hash: string }>("SELECT id,email,name,role,password_hash FROM workspace.users WHERE email=$1", [email]);
    const row = r.rows[0];
    // 존재하지 않는 계정에도 같은 비용의 비밀번호 계산을 수행한다.
    const ok = await verifyPassword(password, row?.password_hash ?? `${"0".repeat(32)}:${"0".repeat(128)}`);
    if (!row || !ok) throw new WorkspaceError("이메일과 비밀번호를 확인해 주세요.", 401);
    const token = randomBytes(32).toString("hex");
    await this.pool.query("INSERT INTO workspace.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')", [tokenHash(token), row.id]);
    await this.pool.query("DELETE FROM workspace.login_attempts WHERE key=$1", [key]);
    const user: User = { id: row.id, email: row.email, name: row.name, role: row.role };
    return { token, user };
  }
  async logout(token: string) { await this.pool.query("DELETE FROM workspace.sessions WHERE token_hash=$1", [tokenHash(token)]); }
  async createUser(actor: User, data: { email: string; name: string; role: User["role"]; password: string }) {
    if (actor.role !== "analyst") throw new WorkspaceError("분석가만 계정을 발급할 수 있습니다.", 403);
    const id = randomUUID();
    await this.pool.query("INSERT INTO workspace.users(id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5)", [id, data.email, data.name, data.role, await passwordHash(data.password)]);
    return { id, email: data.email, name: data.name, role: data.role };
  }
  async users(actor: User) {
    if (actor.role !== "analyst") throw new WorkspaceError("분석가 권한이 필요합니다.", 403);
    return (await this.pool.query<User>("SELECT id,email,name,role FROM workspace.users ORDER BY created_at")).rows;
  }
  async saveAnalysis(user: User, response: AgentResponse) {
    if (response.isMock) return;
    const run = (await this.pool.query<{ log: { retrievedContext?: { matches?: { id: string; version: number }[] } }; schema_version: string }>("SELECT log,schema_version FROM semantic.agent_runs WHERE request_id=$1", [response.requestId])).rows[0];
    if (!run) throw new WorkspaceError("분석 실행 기록을 저장하지 못했습니다.", 503);
    const refs = run.log.retrievedContext?.matches ?? [];
    const definitions = (await this.pool.query("SELECT v.body||jsonb_build_object('version',v.version) AS body FROM semantic.definition_versions v JOIN jsonb_to_recordset($1::jsonb) AS x(id text,version integer) ON v.id=x.id AND v.version=x.version", [JSON.stringify(refs)])).rows.map((r) => r.body);
    await this.pool.query("INSERT INTO workspace.analyses(id,owner_id,title,response,definitions,schema_version) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6) ON CONFLICT DO NOTHING", [response.requestId, user.id, response.question.slice(0, 150), JSON.stringify(response), JSON.stringify(definitions), run.schema_version]);
  }
  async list(user: User, view: string) {
    const r = await this.pool.query<Analysis>(`SELECT a.*,u.name AS owner_name FROM workspace.analyses a JOIN workspace.users u ON u.id=a.owner_id
      WHERE (a.owner_id=$1 OR a.shared=true OR ($2='analyst' AND a.review_status IS NOT NULL))
      AND CASE WHEN $3='saved' THEN a.owner_id=$1 AND a.saved WHEN $3='shared' THEN a.shared WHEN $3='reviews' THEN a.review_status IS NOT NULL AND ($2='analyst' OR a.owner_id=$1) ELSE a.owner_id=$1 END
      ORDER BY a.updated_at DESC LIMIT 100`, [user.id, user.role, view]);
    return r.rows;
  }
  async analysis(user: User, id: string): Promise<Analysis> {
    const a = (await this.pool.query<Analysis>("SELECT a.*,u.name AS owner_name FROM workspace.analyses a JOIN workspace.users u ON u.id=a.owner_id WHERE a.id=$1", [id])).rows[0];
    if (!a || !canRead(user, a)) throw new WorkspaceError("접근할 수 있는 분석이 없습니다.", 404);
    a.events = (await this.pool.query("SELECT e.*,u.name AS actor_name FROM workspace.review_events e JOIN workspace.users u ON u.id=e.actor_id WHERE analysis_id=$1 ORDER BY created_at", [id])).rows;
    return a;
  }
  async updateAnalysis(user: User, id: string, data: { title?: string; saved?: boolean; shared?: boolean }) {
    const a = await this.analysis(user, id);
    if (a.owner_id !== user.id) throw new WorkspaceError("분석 작성자만 저장과 공유 설정을 바꿀 수 있습니다.", 403);
    if (data.shared && !canShare(a.response)) throw new WorkspaceError("개별 고객 식별자가 있거나 결과가 완료되지 않은 분석은 공유할 수 없습니다.");
    await this.pool.query("UPDATE workspace.analyses SET title=coalesce($2,title),saved=coalesce($3,saved),shared=coalesce($4,shared),updated_at=now() WHERE id=$1", [id, data.title ?? null, data.saved ?? null, data.shared ?? null]);
    return this.analysis(user, id);
  }
  async review(user: User, id: string, data: { status: ReviewStatus; message: string; proposedSql: string | null }, currentSchema: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const a = (await client.query<Analysis>("SELECT * FROM workspace.analyses WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!a || !canRead(user, a)) throw new WorkspaceError("접근할 수 있는 분석이 없습니다.", 404);
      if (!canTransition(user, a.owner_id, a.review_status, data.status)) throw new WorkspaceError("현재 상태에서 이 검토 작업을 수행할 수 없습니다.", 403);
      if (data.status === "approved") {
        if (a.response.status !== "passed" || data.proposedSql && data.proposedSql.trim() !== a.response.sql.trim()) throw new WorkspaceError("수정 SQL은 다시 분석하고 검증해야 승인할 수 있습니다.");
        const approved = await client.query(`UPDATE semantic.agent_runs SET approved=true,approved_revision=(SELECT value FROM semantic.revision WHERE singleton=true),approved_at=now()
          WHERE request_id=$1 AND log->>'finalStatus'='passed' AND log->>'definitionVersion'='semantic.v'||(SELECT value::text FROM semantic.revision WHERE singleton=true)
          AND coalesce(jsonb_array_length(log->'resolution'->'candidateIds'),0)=0 AND schema_version=$2 RETURNING request_id`, [id, currentSchema]);
        if (!approved.rowCount) throw new WorkspaceError("공식 정의와 현재 스키마로 다시 실행한 분석만 승인할 수 있습니다. 정의나 데이터 구조가 바뀌었는지 확인해 주세요.", 409);
      }
      await client.query("INSERT INTO workspace.review_events(id,analysis_id,actor_id,status,message,proposed_sql) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), id, user.id, data.status, data.message, data.proposedSql]);
      await client.query("UPDATE workspace.analyses SET review_status=$2,updated_at=now() WHERE id=$1", [id, data.status]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    return this.analysis(user, id);
  }
  async definitionChanges(user: User) {
    return (await this.pool.query("SELECT c.*,u.name AS author_name FROM workspace.definition_changes c JOIN workspace.users u ON u.id=c.author_id WHERE $2='analyst' OR author_id=$1 ORDER BY c.created_at DESC LIMIT 100", [user.id, user.role])).rows;
  }
  async proposeDefinition(user: User, raw: unknown, version: number, reason: string) {
    const body = definitionSchema.parse(raw);
    const r = await this.pool.query("SELECT version FROM semantic.definitions WHERE id=$1", [body.id]);
    if (r.rows[0]?.version !== version) throw new WorkspaceError("정의 버전이 변경됐습니다. 새로고침한 뒤 제안해 주세요.", 409);
    await this.pool.query("INSERT INTO workspace.definition_changes(id,definition_id,base_version,body,reason,author_id) VALUES($1,$2,$3,$4::jsonb,$5,$6)", [randomUUID(), body.id, version, JSON.stringify(body), reason, user.id]);
  }
  async reviewDefinition(user: User, id: string, approved: boolean, note: string) {
    if (user.role !== "analyst") throw new WorkspaceError("분석가 권한이 필요합니다.", 403);
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const change = (await c.query("SELECT * FROM workspace.definition_changes WHERE id=$1 AND status='pending' FOR UPDATE", [id])).rows[0];
      if (!change) throw new WorkspaceError("검토 대기 중인 수정안이 없습니다.", 404);
      if (approved) {
        const body = definitionSchema.parse({ ...change.body, authority: "official", source: `분석가 ${user.name} 검토 승인: ${change.body.source}`.slice(0, 300) });
        const r = await c.query("UPDATE semantic.definitions SET body=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1 AND version=$3", [body.id, JSON.stringify(body), change.base_version]);
        if (!r.rowCount) throw new WorkspaceError("기준 정의가 변경되어 이 수정안을 적용할 수 없습니다.", 409);
        await c.query("UPDATE semantic.revision SET value=value+1 WHERE singleton=true");
      }
      await c.query("UPDATE workspace.definition_changes SET status=$2,reviewer_id=$3,review_note=$4,reviewed_at=now() WHERE id=$1", [id, approved ? "approved" : "rejected", user.id, note]);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }
}
export function workspaceStore() {
  const url = getEnv().DATABASE_URL_APP;
  if (!url) throw new WorkspaceError("워크스페이스 저장소가 설정되지 않았습니다.", 503);
  return new WorkspaceStore(getSemanticPool(url));
}
