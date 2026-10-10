import { describe, expect, it } from "vitest";
import { isPrivilegedDbUrl, parseEnv, readiness } from "./env.schema";

describe("parseEnv", () => {
  it("빈 환경에서 기본값으로 mock 모드가 된다", () => {
    const r = parseEnv({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.env.AGENT_MODE).toBe("mock");
    expect(r.env.GENERATOR_MODEL).toBe("gpt-4.1-mini");
    expect(r.env.VERIFIER_MODEL).toBeUndefined();
    expect(r.env.MAX_RETRIES).toBe(3);
    expect(r.env.SEMANTIC_SCORE_THRESHOLD).toBe(90);
    expect(r.env.ALLOWED_SCHEMAS).toEqual([]);
  });

  it("숫자 설정을 환경변수로 교체할 수 있다", () => {
    const r = parseEnv({ MAX_RETRIES: "5", SEMANTIC_SCORE_THRESHOLD: "85", ALLOWED_SCHEMAS: "analytics, mart" });
    expect(r.ok && r.env.MAX_RETRIES).toBe(5);
    expect(r.ok && r.env.SEMANTIC_SCORE_THRESHOLD).toBe(85);
    expect(r.ok && r.env.ALLOWED_SCHEMAS).toEqual(["analytics", "mart"]);
  });

  it("범위를 벗어난 재시도 횟수를 거부한다", () => {
    expect(parseEnv({ MAX_RETRIES: "99" }).ok).toBe(false);
    expect(parseEnv({ MAX_RETRIES: "-1" }).ok).toBe(false);
  });

  it("읽기 전용 URL에 관리자 계정을 거부한다", () => {
    const r = parseEnv({ DATABASE_URL_READONLY: "postgresql://postgres.abcd:pw@host:6543/postgres" });
    expect(r.ok).toBe(false);
    expect(parseEnv({ DATABASE_URL_READONLY: "postgresql://nl2sql_reader:pw@host:5432/postgres" }).ok).toBe(true);
  });
});

describe("isPrivilegedDbUrl", () => {
  it.each([
    ["postgresql://postgres:pw@h/db", true],
    ["postgresql://postgres.ref:pw@h/db", true],
    ["postgresql://service_role:pw@h/db", true],
    ["postgresql://nl2sql_reader:pw@h/db", false],
    ["not a url", true],
  ])("%s → %s", (url, expected) => {
    expect(isPrivilegedDbUrl(url)).toBe(expected);
  });
});

describe("readiness", () => {
  it("설정이 없으면 기능별 누락 항목을 보고한다", () => {
    const r = parseEnv({});
    if (!r.ok) throw new Error("unreachable");
    const s = readiness(r.env);
    expect(s.semanticVerification).toEqual(["OPENAI_API_KEY", "VERIFIER_MODEL"]);
    expect(s.execution).toEqual(["DATABASE_URL_READONLY", "ALLOWED_SCHEMAS"]);
  });
});
