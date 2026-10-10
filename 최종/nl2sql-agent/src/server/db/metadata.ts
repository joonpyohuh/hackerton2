import type { Pool } from "pg";
import { InMemoryCatalog, type SchemaCatalog } from "@/server/harness/structural/catalog";

/** DB에서 추출한 구조 메타데이터. 의미(지표 정의)는 담지 않는다. */
export type TableMeta = {
  schema: string;
  name: string;
  rowEstimate: number;
  columns: { name: string; type: string; nullable: boolean }[];
  constraints: string[]; // PRIMARY KEY (...), FOREIGN KEY (...) REFERENCES ...
};
export type DbMetadata = { tables: TableMeta[]; catalog: SchemaCatalog; loadedAt: number };

export async function loadMetadata(pool: Pool, schemas: string[]): Promise<DbMetadata> {
  const cols = await pool.query<{ table_schema: string; table_name: string; column_name: string; data_type: string; is_nullable: string }>(
    `SELECT table_schema, table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = ANY($1)
      ORDER BY table_schema, table_name, ordinal_position`,
    [schemas],
  );
  const cons = await pool.query<{ schema: string; table: string; def: string }>(
    `SELECT n.nspname AS schema, c.relname AS table, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1) AND con.contype IN ('p', 'f')
      ORDER BY con.contype DESC, def`,
    [schemas],
  );
  const counts = await pool.query<{ schema: string; table: string; n: number }>(
    `SELECT n.nspname AS schema, c.relname AS table, greatest(c.reltuples, 0)::bigint AS n
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1) AND c.relkind = 'r'`,
    [schemas],
  );

  const byKey = new Map<string, TableMeta>();
  for (const r of cols.rows) {
    const key = `${r.table_schema}.${r.table_name}`;
    let t = byKey.get(key);
    if (!t) {
      t = { schema: r.table_schema, name: r.table_name, rowEstimate: 0, columns: [], constraints: [] };
      byKey.set(key, t);
    }
    t.columns.push({ name: r.column_name, type: r.data_type, nullable: r.is_nullable === "YES" });
  }
  for (const r of cons.rows) byKey.get(`${r.schema}.${r.table}`)?.constraints.push(r.def);
  for (const r of counts.rows) {
    const t = byKey.get(`${r.schema}.${r.table}`);
    if (t) t.rowEstimate = Number(r.n);
  }
  const tables = [...byKey.values()];
  return {
    tables,
    catalog: new InMemoryCatalog(
      tables.map((t) => ({ schema: t.schema, name: t.name, columns: t.columns.map((c) => c.name) })),
      schemas[0] ?? "public",
    ),
    loadedAt: Date.now(),
  };
}

/** 프롬프트용 스키마 설명 (구조 정보만) */
export function renderSchemaContext(tables: TableMeta[]): string {
  return tables
    .map((t) => {
      const cols = t.columns.map((c) => `  - ${c.name} ${c.type}${c.nullable ? "" : " NOT NULL"}`).join("\n");
      const cons = t.constraints.map((d) => `  * ${d}`).join("\n");
      return `${t.schema}.${t.name} (약 ${t.rowEstimate.toLocaleString("ko-KR")}행)\n${cols}${cons ? `\n${cons}` : ""}`;
    })
    .join("\n\n");
}

/** 메타데이터 캐시 (기본 10분). 스키마가 바뀌면 서버 재시작 또는 만료로 갱신. */
export function createMetadataCache(pool: Pool, schemas: string[], ttlMs = 10 * 60_000) {
  let current: Promise<DbMetadata> | null = null;
  return {
    get(): Promise<DbMetadata> {
      if (current) {
        const p = current;
        return p.then((m) => (Date.now() - m.loadedAt < ttlMs ? m : this.refresh()));
      }
      return this.refresh();
    },
    refresh(): Promise<DbMetadata> {
      current = loadMetadata(pool, schemas).catch((e: unknown) => {
        current = null;
        throw e;
      });
      return current;
    },
  };
}
