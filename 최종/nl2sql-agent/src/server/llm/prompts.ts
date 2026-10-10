import { readFile } from "node:fs/promises";
import path from "node:path";
import { StageError } from "@/server/agent/errors";

export type PromptName = "semantic-resolver" | "sql-generator" | "sql-verifier";

const cache = new Map<string, string>();

/** prompts/<name>.<version>.md 를 읽는다. CLAUDE.md(개발 규칙)는 런타임에 읽지 않는다. */
export async function loadPrompt(name: PromptName, version: string, dir = path.join(process.cwd(), "prompts")): Promise<string> {
  const file = path.join(dir, `${name}.${version}.md`);
  const hit = cache.get(file);
  if (hit) return hit;
  try {
    const text = await readFile(file, "utf8");
    cache.set(file, text);
    return text;
  } catch (e) {
    throw new StageError("config", `런타임 프롬프트 파일을 찾을 수 없습니다: ${name}.${version}.md`, false, { cause: e });
  }
}

/** {{key}} 치환. 값이 없는 변수가 남으면 설정 오류로 본다 (빈 문자열은 허용). */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new StageError("config", `프롬프트 변수 ${key}의 값이 없습니다.`, false);
    return value;
  });
}
