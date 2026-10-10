import type { RunLog, RunLogger } from "./types";

/** 테스트·로컬 개발용 */
export class InMemoryRunLogger implements RunLogger {
  readonly logs: RunLog[] = [];
  async save(log: RunLog): Promise<void> {
    this.logs.push(log);
  }
}

/** DB 로거(09단계) 전까지 서버 콘솔에 JSON 한 줄로 남긴다. */
export class ConsoleRunLogger implements RunLogger {
  async save(log: RunLog): Promise<void> {
    console.info(JSON.stringify({ type: "agent_run", ...log }));
  }
}
