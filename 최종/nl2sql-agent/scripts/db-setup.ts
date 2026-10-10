/**
 * DB 구축: 스키마 생성 → CSV 원본 적재 → 읽기 전용 계정 생성 → 권한 자체 검증.
 * 실행: npm run db:setup -- "<CSV 폴더>"
 * 관리자 연결(DATABASE_URL_ADMIN)은 이 스크립트에서만 쓴다. 앱 런타임은 읽기 전용 계정만 사용한다.
 * 로컬(embedded)과 Supabase 모두 같은 스크립트로 구축한다. 재실행하면 데이터를 다시 적재한다(멱등).
 */
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { readEnvFile, upsertEnvFile } from "./lib/envFile";

// 결과 접속 정보를 기록할 파일. Supabase 구축 시: SETUP_ENV_FILE=.env.supabase.local
const ENV_FILE = path.resolve(process.env.SETUP_ENV_FILE ?? ".env.local");
const CSV_DIR = process.argv[2] ?? process.env.DATA_CSV_DIR ?? "C:/Users/hp_user/Desktop/해커톤 데이터";
// 외래키 순서대로 적재
const TABLES = [
  "user_dim",
  "content_dim",
  "content_genre_bridge",
  "behavior_fact",
  "payment_fact",
  "watch_daily_fact",
  "user_content_summary",
] as const;

const env = readEnvFile(ENV_FILE);
const adminUrl = process.env.DATABASE_URL_ADMIN ?? env.DATABASE_URL_ADMIN;

async function countCsvRows(file: string): Promise<number> {
  let lines = 0;
  let last = 10;
  for await (const chunk of createReadStream(file)) {
    const buf = chunk as Buffer;
    for (const b of buf) if (b === 10) lines++;
    last = buf[buf.length - 1] ?? last;
  }
  return lines + (last === 10 ? 0 : 1) - 1; // 헤더 제외
}

function readerUrl(admin: string, password: string): string {
  const u = new URL(admin);
  // Supabase 풀러는 "user.<project_ref>" 형식의 사용자명을 쓴다.
  const suffix = decodeURIComponent(u.username).split(".").slice(1).join(".");
  u.username = suffix ? `nl2sql_reader.${suffix}` : "nl2sql_reader";
  u.password = password;
  return u.toString();
}

async function main() {
  if (!adminUrl) throw new Error("DATABASE_URL_ADMIN이 없습니다. 로컬은 npm run db:local을 먼저 실행하세요.");
  for (const t of TABLES) if (!existsSync(path.join(CSV_DIR, `${t}.csv`))) throw new Error(`CSV 없음: ${t}.csv (${CSV_DIR})`);

  const admin = new Client({ connectionString: adminUrl, ssl: adminUrl.includes("127.0.0.1") ? false : { rejectUnauthorized: false } });
  await admin.connect();
  try {
    console.log("1/4 스키마 생성");
    await admin.query(readFileSync("db/migrations/001_analytics_raw.sql", "utf8"));

    console.log("2/4 CSV 원본 적재");
    await admin.query("BEGIN");
    await admin.query(`TRUNCATE ${TABLES.map((t) => `analytics.${t}`).join(", ")}`);
    for (const t of TABLES) {
      const file = path.join(CSV_DIR, `${t}.csv`);
      const header = readFileSync(file, "utf8").slice(0, 2000).split(/\r?\n/)[0].replace(/^\uFEFF/, "");
      const columns = header.split(",").map((c) => `"${c.trim()}"`).join(", ");
      const stream = admin.query(copyFrom(`COPY analytics.${t} (${columns}) FROM STDIN WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')`));
      await pipeline(createReadStream(file), stream);
      const expected = await countCsvRows(file);
      const loaded = stream.rowCount;
      console.log(`   ${t.padEnd(22)} ${String(loaded).padStart(8)}행 ${loaded === expected ? "✓" : `✗ (CSV ${expected}행)`}`);
      if (loaded !== expected) throw new Error(`${t} 적재 행 수 불일치`);
    }
    await admin.query("COMMIT");
    await admin.query("ANALYZE");

    console.log("3/4 읽기 전용 계정 생성");
    const password = randomBytes(24).toString("hex"); // 16진수 — SQL 리터럴 이스케이프 불필요
    const roleSql = readFileSync("db/migrations/002_readonly_role.sql", "utf8").replace(":'reader_password'", `'${password}'`);
    await admin.query(roleSql);
    const url = readerUrl(adminUrl, password);
    upsertEnvFile(ENV_FILE, { DATABASE_URL_READONLY: url, ALLOWED_SCHEMAS: "analytics" });
  } catch (e) {
    await admin.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await admin.end();
  }

  console.log("4/4 권한 자체 검증 (읽기 전용 계정)");
  const readerConn = readEnvFile(ENV_FILE).DATABASE_URL_READONLY;
  const reader = new Client({ connectionString: readerConn, ssl: readerConn.includes("127.0.0.1") ? false : { rejectUnauthorized: false } });
  await reader.connect();
  const expectFail = async (label: string, sql: string) => {
    const ok = await reader.query(sql).then(
      () => false,
      () => true,
    );
    console.log(`   ${ok ? "✓" : "✗"} ${label} 차단`);
    if (!ok) throw new Error(`읽기 전용 계정에서 ${label}이(가) 허용됨`);
  };
  try {
    const { rows } = await reader.query<{ n: string }>("SELECT count(*) AS n FROM user_dim");
    console.log(`   ✓ 조회 가능 (user_dim ${rows[0]?.n}행)`);
    await expectFail("INSERT", "INSERT INTO analytics.user_dim VALUES ('x', '2025-01-01', 'pc', 0, 'UNKNOWN', 0)");
    await expectFail("CREATE TABLE", "CREATE TABLE analytics.tmp_x (a int)");
    await expectFail("public 스키마 쓰기", "CREATE TABLE public.tmp_x (a int)");
    await expectFail("읽기 전용 해제", "BEGIN READ WRITE; DELETE FROM analytics.user_dim; ROLLBACK");
  } finally {
    await reader.end();
  }
  console.log("완료 — .env.local에 DATABASE_URL_READONLY, ALLOWED_SCHEMAS 기록");
}

main().catch((e: unknown) => {
  console.error("DB 구축 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
