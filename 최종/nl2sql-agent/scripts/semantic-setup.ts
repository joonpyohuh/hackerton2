/**
 * Neon 관리자 URL로 semantic 저장소·전용 앱 계정·초기 정의를 준비한다.
 * ADMIN_ENV_FILE=.env.neon.bootstrap npm run semantic:setup
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { readEnvFile, upsertEnvFile } from "./lib/envFile";
import { definitionSchema, SEED_DEFINITIONS } from "../src/server/semantic/definitions";

const localFile = path.resolve(".env.local");
const adminFile = readEnvFile(path.resolve(process.env.ADMIN_ENV_FILE ?? ".env.local"));
const adminRaw = process.env.DATABASE_URL_ADMIN ?? adminFile.DATABASE_URL_ADMIN ?? adminFile.DATABASE_URL_UNPOOLED;
const adminUrl = adminRaw?.startsWith('"') ? JSON.parse(adminRaw) as string : adminRaw;
if (!adminUrl) throw new Error("DATABASE_URL_ADMIN 또는 DATABASE_URL_UNPOOLED이 필요합니다.");

const password = randomBytes(24).toString("hex");
const appUrl = new URL(adminUrl);
appUrl.username = "nl2sql_app";
appUrl.password = password;
if (appUrl.hostname.endsWith(".neon.tech") && !appUrl.hostname.split(".")[0].endsWith("-pooler")) {
  const parts = appUrl.hostname.split(".");
  parts[0] += "-pooler";
  appUrl.hostname = parts.join(".");
}
const ssl = /@(127\.0\.0\.1|localhost)[:/]/.test(adminUrl) ? false : { rejectUnauthorized: false };
const admin = new Client({ connectionString: adminUrl, ssl });

async function main() {
try {
  await admin.connect();
  await admin.query(readFileSync("db/migrations/003_semantic.sql", "utf8"));
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nl2sql_app') THEN
      CREATE ROLE nl2sql_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 50;
    END IF;
  END $$`);
  await admin.query(`ALTER ROLE nl2sql_app WITH PASSWORD '${password}'`);
  await admin.query("ALTER ROLE nl2sql_app CONNECTION LIMIT 50");
  await admin.query("GRANT USAGE ON SCHEMA semantic TO nl2sql_app");
  await admin.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA semantic TO nl2sql_app");
  let inserted = 0;
  for (const raw of SEED_DEFINITIONS) {
    const item = definitionSchema.parse(raw);
    const result = await admin.query("INSERT INTO semantic.definitions (id, body) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING", [item.id, JSON.stringify(item)]);
    inserted += result.rowCount ?? 0;
  }
  if (inserted) await admin.query("UPDATE semantic.revision SET value=value+1 WHERE singleton=true");
} finally {
  await admin.end();
}

const reader = new Client({ connectionString: appUrl.toString(), ssl });
try {
  await reader.connect();
  const result = await reader.query<{ n: string }>("SELECT count(*) AS n FROM semantic.definitions");
  const analyticsBlocked = await reader.query("SELECT 1 FROM analytics.user_dim LIMIT 1").then(() => false, () => true);
  if (!analyticsBlocked) throw new Error("앱 계정의 analytics 접근이 차단되지 않았습니다.");
  console.log(`시맨틱 정의 ${result.rows[0]?.n}개 적재 · 앱 계정 analytics 접근 차단 확인`);
} finally {
  await reader.end();
}
upsertEnvFile(localFile, { DATABASE_URL_APP: appUrl.toString() });
console.log("앱 접속 정보를 .env.local에 저장했습니다.");
}

main().catch((error: unknown) => {
  console.error("시맨틱 저장소 준비 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
