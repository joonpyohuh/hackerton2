/**
 * 코드의 SEED_DEFINITIONS를 DB(semantic.definitions)에 반영한다.
 * - 없는 정의는 추가한다.
 * - 이미 있고 내용이 다른 정의는 덮어쓰지 않고 경고만 출력한다(운영 중 화면에서 고친 내용 보존).
 * npm run semantic:sync
 */
import path from "node:path";
import { Pool } from "pg";
import { readEnvFile } from "./lib/envFile";
import { definitionSchema, SEED_DEFINITIONS } from "../src/server/semantic/definitions";
import { SemanticStore } from "../src/server/semantic/store";

const env = readEnvFile(path.resolve(".env.local"));
const raw = env.DATABASE_URL_APP;
if (!raw) throw new Error("DATABASE_URL_APP이 .env.local에 필요합니다.");
const url = raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
const ssl = /@(127\.0\.0\.1|localhost)[:/]/.test(url) ? false : { rejectUnauthorized: false };

const pool = new Pool({ connectionString: url, max: 1, ssl });
const store = new SemanticStore(pool);

async function main() {
  const current = new Map((await store.list()).map((item) => [item.id, item]));
  let created = 0;
  let same = 0;
  const differs: string[] = [];
  try {
    for (const seed of SEED_DEFINITIONS) {
      const item = definitionSchema.parse(seed);
      const existing = current.get(item.id);
      if (!existing) {
        await store.create(item);
        created += 1;
      } else if (JSON.stringify(definitionSchema.parse(existing)) === JSON.stringify(item)) {
        same += 1;
      } else {
        differs.push(item.id);
      }
    }
  } finally {
    await pool.end();
  }
  console.log(`추가 ${created}개 · 동일 ${same}개 · 내용 차이(덮어쓰지 않음) ${differs.length}개`);
  if (differs.length) console.log(`차이 ID: ${differs.join(", ")}`);
}

main().catch((error: unknown) => {
  console.error("시맨틱 정의 동기화 실패:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
