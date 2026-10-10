import { Pool, type PoolClient } from "pg";
import type { RunLog } from "@/server/agent/types";
import { definitionSchema, type StoredDefinition } from "./definitions";

export class SemanticStore {
  constructor(private readonly pool: Pool) {}

  private async change<T>(write: (client: PoolClient) => Promise<{ value: T; changed: boolean }>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await write(client);
      if (result.changed) await client.query("UPDATE semantic.revision SET value=value+1 WHERE singleton=true");
      await client.query("COMMIT");
      return result.value;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async revision(): Promise<number> {
    const r = await this.pool.query<{ value: string }>("SELECT value FROM semantic.revision WHERE singleton = true");
    return Number(r.rows[0]?.value ?? 0);
  }

  async list(): Promise<StoredDefinition[]> {
    const r = await this.pool.query<{ body: unknown; version: number }>("SELECT body, version FROM semantic.definitions ORDER BY id");
    return r.rows.map((row) => ({ ...definitionSchema.parse(row.body), version: row.version }));
  }

  async create(raw: unknown): Promise<StoredDefinition> {
    const item = definitionSchema.parse(raw);
    return this.change(async (client) => {
      await client.query("INSERT INTO semantic.definitions (id, body) VALUES ($1, $2::jsonb)", [item.id, JSON.stringify(item)]);
      return { value: { ...item, version: 1 }, changed: true };
    });
  }

  async update(raw: unknown, expectedVersion: number): Promise<StoredDefinition | null> {
    const item = definitionSchema.parse(raw);
    return this.change(async (client) => {
      const r = await client.query<{ version: number }>(
        "UPDATE semantic.definitions SET body=$2::jsonb, version=version+1, updated_at=now() WHERE id=$1 AND version=$3 RETURNING version",
        [item.id, JSON.stringify(item), expectedVersion],
      );
      return { value: r.rows[0] ? { ...item, version: r.rows[0].version } : null, changed: Boolean(r.rows[0]) };
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.change(async (client) => {
      const r = await client.query("DELETE FROM semantic.definitions WHERE id=$1", [id]);
      return { value: Boolean(r.rowCount), changed: Boolean(r.rowCount) };
    });
  }

  async saveRun(log: RunLog): Promise<void> {
    await this.pool.query(
      "INSERT INTO semantic.agent_runs (request_id, log) VALUES ($1, $2::jsonb) ON CONFLICT (request_id) DO NOTHING",
      [log.requestId, JSON.stringify(log)],
    );
  }

  async runs(): Promise<{ requestId: string; log: RunLog; approved: boolean; approvedAt: string | null }[]> {
    const r = await this.pool.query<{ request_id: string; log: RunLog; approved: boolean; approved_at: Date | null }>(
      "SELECT request_id, log, approved, approved_at FROM semantic.agent_runs ORDER BY created_at DESC LIMIT 50",
    );
    return r.rows.map((row) => ({
      requestId: row.request_id, log: row.log, approved: row.approved, approvedAt: row.approved_at?.toISOString() ?? null,
    }));
  }

  async approve(requestId: string, approved: boolean): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE semantic.agent_runs SET approved=$2,
        approved_revision=CASE WHEN $2 THEN (SELECT value FROM semantic.revision WHERE singleton=true) ELSE NULL END,
        approved_at=CASE WHEN $2 THEN now() ELSE NULL END
        WHERE request_id=$1 AND log->>'finalStatus'='passed' AND log->>'finalSql' IS NOT NULL
          AND (NOT $2 OR log->>'definitionVersion' = 'semantic.v' || (SELECT value::text FROM semantic.revision WHERE singleton=true))
          -- 후보(비공식) 정의로 계산한 결과는 확정 지식으로 승인하지 않는다. 정의를 공식화한 뒤 다시 실행해야 한다.
          AND (NOT $2 OR coalesce(jsonb_array_length(log->'resolution'->'candidateIds'), 0) = 0)`,
      [requestId, approved],
    );
    return Boolean(r.rowCount);
  }

  async approvedExamples(revision: number): Promise<{ requestId: string; question: string; sql: string; definitionIds: string[] }[]> {
    // ponytail: 전역 revision 변경 시 기존 승인 사례를 모두 제외한다. 정의별 의존성 추적이 필요해질 때만 세분화한다.
    const r = await this.pool.query<{ request_id: string; question: string; sql: string; matches: { id: string; score: number }[] | null }>(
      `SELECT request_id, log->>'question' AS question, log->>'finalSql' AS sql,
         log->'retrievedContext'->'matches' AS matches
       FROM semantic.agent_runs WHERE approved=true AND approved_revision=$1
       ORDER BY approved_at DESC LIMIT 100`,
      [revision],
    );
    return r.rows.map((row) => ({
      requestId: row.request_id, question: row.question, sql: row.sql,
      definitionIds: (row.matches ?? []).filter((match) => match.score >= 8).map((match) => match.id),
    }));
  }
}

const globalStore = globalThis as unknown as { nl2sqlSemanticStore?: { url: string; store: SemanticStore } };
export function getSemanticStore(url: string): SemanticStore {
  const existing = globalStore.nl2sqlSemanticStore;
  if (existing?.url === url) return existing.store;
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
    ssl: /@(127\.0\.0\.1|localhost)[:/]/.test(url) ? false : { rejectUnauthorized: false },
    application_name: "nl2sql-agent-semantic",
  });
  const store = new SemanticStore(pool);
  globalStore.nl2sqlSemanticStore = { url, store };
  return store;
}
