import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { WorkspaceStore } from "./store";

vi.mock("server-only", () => ({}));

describe("visitor entry", () => {
  it("creates an isolated marketer session without an email or password prompt", async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("RETURNING attempts") ? [{ attempts: 1 }] : [] }));
    const store = new WorkspaceStore({ query } as unknown as Pool);
    const { user, token } = await store.guest("127.0.0.1");
    expect(user.role).toBe("marketer");
    expect(user.email).toBe(`${user.id}@guest.local`);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringContaining("workspace.login_attempts"),
      expect.stringContaining("workspace.users"),
      expect.stringContaining("workspace.sessions"),
    ]);
  });
  it("limits public AI calls before spending model credits", async () => {
    const query = vi.fn(async () => ({ rows: [{ attempts: 21 }] }));
    await expect(new WorkspaceStore({ query } as unknown as Pool).limitGuestAnalysis("127.0.0.1")).rejects.toMatchObject({ status: 429 });
  });
});
