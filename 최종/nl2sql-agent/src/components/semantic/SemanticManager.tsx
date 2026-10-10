"use client";

import { useEffect, useState } from "react";
import type { StoredDefinition } from "@/server/semantic/definitions";
import type { RunLog } from "@/server/agent/types";

type SearchResult = {
  matches: { id: string; name: string; kind: string; score: number; version: number }[];
  exampleMatches: { requestId: string; question: string; score: number }[];
  schemaContext: string;
  semanticContext: string;
  examples: string;
};
type Run = { requestId: string; log: RunLog; approved: boolean; approvedAt: string | null };
const template = {
  id: "new_metric", kind: "metric", name: "새 지표", aliases: [], description: "업무 정의를 입력하세요.",
  tables: ["analytics.user_dim"], columns: [], joins: [], rule: "정확한 SQL 계산 조건을 입력하세요.",
  numerator: null, denominator: null, grain: "고객", period: "관측 기간", unit: "명",
  missing: "0건일 때 처리 방법을 입력하세요.", caveat: "", status: "ready",
};

async function json(res: Response) {
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export function SemanticManager() {
  const [definitions, setDefinitions] = useState<StoredDefinition[]>([]);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const body = await json(await fetch("/api/semantic", { cache: "no-store" }));
    setDefinitions(body.definitions);
  };
  useEffect(() => {
    fetch("/api/semantic", { cache: "no-store" })
      .then(json)
      .then((body) => setDefinitions(body.definitions))
      .catch((e) => setMessage(String(e)));
  }, []);

  const request = async (url: string, method: string, body?: unknown) =>
    json(await fetch(url, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }));

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try { await action(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const search = () => act(async () => {
    if (!query.trim()) return setResult(null);
    setResult(await json(await fetch(`/api/semantic?question=${encodeURIComponent(query.trim())}`, { cache: "no-store" })));
  });
  const save = () => act(async () => {
    const parsed = JSON.parse(draft) as StoredDefinition;
    const { version, ...definition } = parsed;
    await request("/api/semantic", version ? "PUT" : "POST", version ? { definition, version } : definition);
    await refresh();
    setDraft("");
    setMessage("정의를 저장했습니다. 다음 질문부터 새 버전을 검색합니다.");
  });
  const remove = (id: string) => act(async () => {
    if (!window.confirm(`${id} 정의를 삭제할까요?`)) return;
    await request(`/api/semantic?id=${encodeURIComponent(id)}`, "DELETE");
    await refresh();
    setMessage("정의를 삭제했습니다.");
  });
  const loadRuns = () => act(async () => setRuns((await request("/api/semantic/runs", "GET")).runs));
  const review = (run: Run, approved: boolean) => act(async () => {
    await request("/api/semantic/runs", "PATCH", { requestId: run.requestId, approved });
    setRuns((await request("/api/semantic/runs", "GET")).runs);
    setMessage(approved ? "사례를 승인했습니다. 같은 정의 버전의 유사 질문에 재활용합니다." : "사례 승인을 취소했습니다.");
  });

  return (
    <main className="mx-auto w-full max-w-[1040px] px-5 pb-16 pt-10 text-ink sm:px-8">
      <h1 className="text-3xl font-semibold">시맨틱 정의와 승인 사례</h1>
      <p className="mt-2 text-sm text-sub">업무 정의를 질문별로 검색합니다. 실행 통과 사례는 담당자가 검토해 승인한 뒤에만 참고 SQL로 재활용합니다.</p>
      {message && <p role="status" className="mt-4 rounded border border-accent bg-surface p-3 text-sm">{message}</p>}

      <section className="mt-10 border-t border-line pt-5">
        <h2 className="text-xl font-semibold">질문별 Context 검색</h2>
        <form onSubmit={(e) => { e.preventDefault(); search(); }} className="mt-3 flex gap-2">
          <input aria-label="검색할 질문" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={500}
            placeholder="예: 20대 초기 미시청률은?" className="min-w-0 flex-1 rounded border border-line bg-white px-3 py-2 text-ink" />
          <button disabled={busy} className="rounded bg-accent px-4 py-2 font-medium text-white disabled:opacity-50">검색</button>
        </form>
        {result && (
          <div className="mt-4 text-sm">
            <p>검색 정의: {result.matches.length ? result.matches.map((m) => `${m.name} (${m.score}점)`).join(" · ") : "없음"}</p>
            <p>승인 사례: {result.exampleMatches.length}건</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-accent">Agent에 전달되는 Context 보기</summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded border border-line bg-surface p-3 text-xs">
                {`정의\n${result.semanticContext || "(없음)"}\n\n스키마\n${result.schemaContext}\n\n승인 사례\n${result.examples || "(없음)"}`}
              </pre>
            </details>
          </div>
        )}
      </section>

      <section className="mt-10 border-t border-line pt-5">
        <h2 className="text-xl font-semibold">정의 목록 ({definitions.length})</h2>
        <div className="mt-3 grid gap-3">
          {definitions.map((item) => (
            <article key={item.id} className="rounded border border-line bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{item.name} <span className="text-xs font-normal text-sub">· {item.kind} · v{item.version}</span></h3>
                <div className="flex gap-3 text-sm">
                  <button onClick={() => setDraft(JSON.stringify(item, null, 2))} className="text-accent underline">편집</button>
                  <button onClick={() => remove(item.id)} disabled={busy} className="text-accent underline">삭제</button>
                </div>
              </div>
              <p className="mt-1 text-sm text-sub">{item.description}</p>
              <p className="mt-1 text-xs text-mute">{item.status === "needs_data" ? "원천 데이터 부족 · 계산 차단" : item.aliases.join(" · ")}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-10 border-t border-line pt-5">
        <h2 className="text-xl font-semibold">관리자 작업</h2>
        <label className="mt-3 block text-sm">관리 토큰
          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)}
            className="mt-1 block w-full max-w-md rounded border border-line bg-white px-3 py-2" />
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => setDraft(JSON.stringify(template, null, 2))} className="rounded border border-accent px-3 py-2 text-sm text-accent">새 정의</button>
          <button onClick={loadRuns} disabled={busy || !token} className="rounded border border-accent px-3 py-2 text-sm text-accent disabled:opacity-50">실행 기록 불러오기</button>
        </div>
        {draft && (
          <div className="mt-4">
            <label htmlFor="definition-json" className="block text-sm font-medium">정의 JSON 편집</label>
            <textarea id="definition-json" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false}
              className="mt-1 h-96 w-full rounded border border-line bg-white p-3 font-mono text-xs" />
            <button onClick={save} disabled={busy || !token} className="mt-2 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">저장</button>
          </div>
        )}
        {runs.length > 0 && <div className="mt-5 space-y-3">
          {runs.map((run) => <article key={run.requestId} className="rounded border border-line bg-white p-4 text-sm">
            <p className="font-medium">{run.log.question}</p>
            <p className="text-sub">결과 {run.log.finalStatus} · {run.approved ? "담당자 승인" : "미승인"} · {run.log.definitionVersion}</p>
            {run.log.finalSql && <pre className="mt-2 overflow-auto whitespace-pre-wrap bg-surface p-2 text-xs">{run.log.finalSql}</pre>}
            {run.log.finalStatus === "passed" && <button onClick={() => review(run, !run.approved)} disabled={busy}
              className="mt-2 text-accent underline">{run.approved ? "승인 취소" : "검토 후 승인"}</button>}
          </article>)}
        </div>}
      </section>
    </main>
  );
}
