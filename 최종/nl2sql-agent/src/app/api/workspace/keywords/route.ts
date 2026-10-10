import { NextResponse } from "next/server";
import { getEnv } from "@/server/config/env";
import { getSemanticStore } from "@/server/semantic/store";
import { createReaderPool } from "@/server/db/executor";
import { keywordCatalog } from "@/server/workspace/keywords";
import { requireUser, workspaceError } from "@/server/workspace/access";
import { z } from "zod";
import { WorkspaceError } from "@/server/workspace/store";
export async function GET(req: Request) {
  const user = await requireUser(req); if (user instanceof Response) return user;
  let pool;
  try {
    const env = getEnv();
    if (!env.DATABASE_URL_APP || !env.DATABASE_URL_READONLY) throw new Error("데이터 연결 없음");
    pool = createReaderPool(env.DATABASE_URL_READONLY);
    const [definitions, range] = await Promise.all([
      getSemanticStore(env.DATABASE_URL_APP).list(),
      pool.query<{ start: string; end: string; latest: string }>("SELECT (SELECT min(signup_date)::text FROM analytics.user_dim) AS start,(SELECT max(signup_date)::text FROM analytics.user_dim) AS end,(SELECT greatest(max(payment_date),(SELECT max(watch_date) FROM analytics.watch_daily_fact),(SELECT max(event_date) FROM analytics.behavior_fact))::text FROM analytics.payment_fact) AS latest"),
    ]);
    const r = range.rows[0];
    return NextResponse.json(keywordCatalog(definitions, { start: r.start, end: r.end }, r.latest));
  } catch (e) { return workspaceError(e); } finally { await pool?.end(); }
}
export async function POST(req: Request) {
  const user = await requireUser(req); if (user instanceof Response) return user;
  try {
    const data = z.object({ target: z.string().max(64), metric: z.string().max(64), method: z.string().max(64), start: z.iso.date(), end: z.iso.date() }).parse(await req.json());
    const defs = await getSemanticStore(getEnv().DATABASE_URL_APP!).list();
    const metric = defs.find((d) => d.id === data.metric && d.kind === "metric" && d.authority === "official" && d.status === "ready");
    if (!metric) throw new WorkspaceError("공식 산식이 등록된 지표를 선택해 주세요.");
    const target = data.target === "all" ? null : defs.find((d) => d.id === data.target && d.kind === "term" && d.authority === "official" && d.status === "ready");
    if (data.target !== "all" && !target) throw new WorkspaceError("현재 지원하는 분석 대상을 선택해 주세요.");
    if (target && metric.denominator) throw new WorkspaceError("이 지표의 분모는 공식 정의로 고정되어 있습니다. 전체 가입 고객을 선택하거나 질문에 변경 기준을 직접 적어 주세요.");
    if (data.start > data.end) throw new WorkspaceError("시작일은 종료일보다 이전이어야 합니다.");
    const dimension = ["total", "trend"].includes(data.method) ? null : defs.find((d) => d.id === data.method && d.kind === "dimension" && d.authority === "official");
    if (!dimension && !["total", "trend"].includes(data.method)) throw new WorkspaceError("등록된 비교 방식을 선택해 주세요.");
    if (dimension && !dimension.tables.some((t) => metric.tables.includes(t))) throw new WorkspaceError("이 지표와 비교 기준의 공통 원천이 확인되지 않았습니다. 전체 요약을 선택하거나 지표 사전에서 연결 기준 검토를 요청해 주세요.");
    return NextResponse.json({ question: `${data.start}부터 ${data.end}까지 가입한 ${target?.name ?? "전체 고객"}의 ${metric.name}을 ${dimension ? `${dimension.name}별로 비교해줘` : data.method === "trend" ? "가입 월별로 비교해줘" : "알려줘"}.` });
  } catch (e) { return workspaceError(e); }
}
