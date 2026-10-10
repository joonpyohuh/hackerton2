import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { readEnvFile } from "./lib/envFile";
import { passwordHash } from "../src/server/workspace/password";

async function main() {
  const env = readEnvFile(process.env.ADMIN_ENV_FILE ?? ".env.workspace");
  const raw = process.env.DATABASE_URL_ADMIN ?? env.DATABASE_URL_ADMIN ?? env.DATABASE_URL_UNPOOLED;
  if (!raw) throw new Error("관리자 DB 연결이 필요합니다.");
  const connectionString = raw.startsWith('"') ? JSON.parse(raw) as string : raw;
  const client = new Client({ connectionString, ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString) ? false : { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query(readFileSync("db/migrations/004_workspace.sql", "utf8"));
    const count = await client.query("SELECT count(*)::int AS n FROM workspace.users");
    if (count.rows[0].n === 0) {
      const account = { email: "analyst@workspace.local", name: "워크스페이스 분석가", role: "analyst", password: randomBytes(18).toString("base64url") };
      await client.query("INSERT INTO workspace.users(id,email,name,role,password_hash) VALUES($1,$2,$3,'analyst',$4)", [randomUUID(), account.email, account.name, await passwordHash(account.password)]);
      if (!existsSync(".workspace-owner.local.json")) writeFileSync(".workspace-owner.local.json", JSON.stringify(account, null, 2), { mode: 0o600 });
      console.log("초기 분석가 계정: .workspace-owner.local.json (비공개 파일)");
    }
    console.log("워크스페이스 마이그레이션 적용 완료 · analytics 원본 유지");
  } finally { await client.end(); }
}
main().catch((e: unknown) => { console.error("워크스페이스 초기화 실패:", e instanceof Error ? e.name : "unknown"); process.exitCode = 1; });
