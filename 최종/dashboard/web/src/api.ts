import type { Analysis, Facts, Filters } from "./types";

const qs = (f: Filters): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  return p.toString();
};

async function parse<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const body: unknown = await resp.json();
      if (body && typeof body === "object" && "detail" in body) detail = String((body as { detail: unknown }).detail);
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return (await resp.json()) as T;
}

export async function fetchFacts(filters: Filters, signal?: AbortSignal): Promise<Facts> {
  try {
    return await parse<Facts>(await fetch("/api/relations?" + qs(filters), { signal, cache: "no-store" }));
  } catch (e) {
    if (e instanceof TypeError) throw new Error("백엔드에 연결할 수 없습니다. RUN_WINDOWS.bat 또는 uvicorn으로 서버를 실행하세요.");
    throw e;
  }
}

export async function analyze(filters: Filters): Promise<Analysis> {
  const resp = await fetch("/api/relations/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filters }),
  });
  return parse<Analysis>(resp);
}
