import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** .env.local 읽기 (따옴표 미지원 단순 KEY=VALUE). 값은 절대 출력하지 않는다. */
export function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** 기존 키는 값만 교체하고, 없는 키는 끝에 추가한다. 다른 줄은 건드리지 않는다. */
export function upsertEnvFile(file: string, values: Record<string, string>): void {
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
  const pending = new Map(Object.entries(values));
  const next = lines.map((line) => {
    const key = /^([A-Z0-9_]+)=/.exec(line.trim())?.[1];
    if (key && pending.has(key)) {
      const v = pending.get(key);
      pending.delete(key);
      return `${key}=${v}`;
    }
    return line;
  });
  while (next.length && next[next.length - 1] === "") next.pop();
  for (const [k, v] of pending) next.push(`${k}=${v}`);
  writeFileSync(file, next.join("\n") + "\n", "utf8");
}
