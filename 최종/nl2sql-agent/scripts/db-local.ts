/**
 * 로컬 개발용 PostgreSQL. 실행: npm run db:local — 종료: Ctrl+C
 *
 * 바이너리는 @embedded-postgres 패키지에서 가져오되, 영문 경로(~/.nl2sql-agent/pgbin)로 복사해 직접 실행한다.
 * 이유: 프로젝트 경로에 한글이 있으면 Windows initdb가 경로를 CP949로 넘겨
 *       "invalid byte sequence for encoding UTF8: 0xbf"로 실패한다 (2026-10-10 재현·확인).
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { readEnvFile, upsertEnvFile } from "./lib/envFile";

const ENV_FILE = path.resolve(".env.local");
const HOME = path.join(os.homedir(), ".nl2sql-agent");
const BIN_DIR = path.join(HOME, "pgbin");
const DATA_DIR = path.join(HOME, "pgdata");
const PORT = 54329;
const DB = "nl2sql";

const PLATFORM: Record<string, string> = { "win32-x64": "windows-x64", "darwin-arm64": "darwin-arm64", "darwin-x64": "darwin-x64", "linux-x64": "linux-x64" };
const exe = (name: string) => path.join(BIN_DIR, "bin", process.platform === "win32" ? `${name}.exe` : name);

function ensureBinaries() {
  if (existsSync(exe("postgres"))) return;
  const pkg = PLATFORM[`${process.platform}-${process.arch}`];
  if (!pkg) throw new Error(`지원하지 않는 플랫폼: ${process.platform}-${process.arch}`);
  const src = path.resolve("node_modules", "@embedded-postgres", pkg, "native");
  if (!existsSync(src)) throw new Error(`PostgreSQL 바이너리가 없습니다: ${src} (npm install 확인)`);
  mkdirSync(BIN_DIR, { recursive: true });
  cpSync(src, BIN_DIR, { recursive: true });
}

function initCluster(password: string) {
  const pwfile = path.join(HOME, "pwfile.tmp");
  writeFileSync(pwfile, password, { mode: 0o600 });
  try {
    const r = spawnSync(exe("initdb"), ["-D", DATA_DIR, "-U", "postgres", `--pwfile=${pwfile}`, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    if (r.status !== 0) throw new Error(`initdb 실패 (code ${r.status}): ${r.stderr.toString().slice(-500)}`);
  } finally {
    rmSync(pwfile, { force: true });
  }
}

async function waitReady(password: string, database: string) {
  for (let i = 0; i < 60; i++) {
    const c = new Client({ host: "127.0.0.1", port: PORT, user: "postgres", password, database });
    try {
      await c.connect();
      await c.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("PostgreSQL이 30초 안에 시작되지 않았습니다.");
}

async function main() {
  ensureBinaries();
  const fresh = !existsSync(path.join(DATA_DIR, "PG_VERSION"));
  let password = readEnvFile(ENV_FILE).LOCAL_PG_PASSWORD;
  if (!fresh && !password) throw new Error(`${DATA_DIR}가 이미 있지만 .env.local에 LOCAL_PG_PASSWORD가 없습니다.`);
  if (fresh) {
    password = randomBytes(18).toString("hex");
    initCluster(password);
    upsertEnvFile(ENV_FILE, {
      LOCAL_PG_PASSWORD: password,
      DATABASE_URL_ADMIN: `postgresql://postgres:${password}@127.0.0.1:${PORT}/${DB}`,
    });
  }
  if (!password) throw new Error("unreachable");

  const server = spawn(exe("postgres"), ["-D", DATA_DIR, "-p", String(PORT), "-c", "listen_addresses=127.0.0.1"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr.on("data", (d: Buffer) => {
    const s = d.toString();
    if (/FATAL|PANIC|ERROR/.test(s)) console.error(s.trim());
  });
  server.on("exit", (code) => {
    console.log(`PostgreSQL 종료 (code ${code})`);
    process.exit(code ?? 0);
  });

  await waitReady(password, "postgres");
  if (fresh) {
    const c = new Client({ host: "127.0.0.1", port: PORT, user: "postgres", password, database: "postgres" });
    await c.connect();
    await c.query(`CREATE DATABASE ${DB} ENCODING 'UTF8'`);
    await c.end();
  }
  console.log(`로컬 PostgreSQL 실행 중 — 127.0.0.1:${PORT}/${DB} (Ctrl+C로 종료)`);

  const stop = () => {
    spawnSync(exe("pg_ctl"), ["stop", "-D", DATA_DIR, "-m", "fast"], { stdio: "ignore" });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e: unknown) => {
  console.error("로컬 DB 실행 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
