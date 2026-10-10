import "server-only";
import { parseEnv, type Env } from "./env.schema";

export class EnvConfigError extends Error {
  constructor(public readonly errors: string[]) {
    super(`환경변수 설정 오류:\n- ${errors.join("\n- ")}`);
    this.name = "EnvConfigError";
  }
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const result = parseEnv(process.env);
  if (!result.ok) throw new EnvConfigError(result.errors);
  cached = result.env;
  return cached;
}
