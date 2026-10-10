"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Analysis, KeywordCatalog, User } from "@/lib/workspace";
import { REVIEW_LABEL } from "@/lib/workspace";
import type { StoredDefinition } from "@/server/semantic/definitions";
import { useAgentStream } from "@/components/chat/useAgentStream";
import { ResultView } from "./ResultView";
import { Dictionary } from "./Dictionary";

export async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "요청을 처리하지 못했습니다.");
  return data;
}
const NAV = [{ id: "new", icon: "＋", label: "새 분석 시작" }, { id: "recent", icon: "◷", label: "최근 분석 기록" }, { id: "saved", icon: "◇", label: "저장된 분석" }, { id: "shared", icon: "↗", label: "공유된 분석" }, { id: "reviews", icon: "✓", label: "검토 요청" }, { id: "dictionary", icon: "▤", label: "지표 사전" }, { id: "settings", icon: "⚙", label: "설정" }];
const STAGES: Record<string, string> = { resolving: "질문의 분석 기준을 확인하고 있어요", retrieving: "분석에 필요한 지표 정의를 찾고 있어요", generating: "데이터 조회 방법을 구성하고 있어요", structural: "안전한 조회인지 확인하고 있어요", semantic: "지표 정의와 계산 조건을 대조하고 있어요", executing: "읽기 전용으로 데이터를 조회하고 있어요", correcting: "확인된 오류를 수정하고 있어요" };

export function Workspace({ mode, initialView = "new" }: { mode: "mock" | "live"; initialView?: string }) {
  const [user, setUser] = useState<User | null>(null), [loading, setLoading] = useState(true);
  const [view, setView] = useState(initialView), [message, setMessage] = useState("");
  const [catalog, setCatalog] = useState<KeywordCatalog | null>(null), [definitions, setDefinitions] = useState<StoredDefinition[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]), [selected, setSelected] = useState<Analysis | null>(null);
  const [draft, setDraft] = useState(""), [busy, setBusy] = useState(false), [mobileNav, setMobileNav] = useState(false);
  const [choice, setChoice] = useState({ target: "all", metric: "", period: "available", method: "total" });
  const [dates, setDates] = useState({ start: "", end: "" });
  const { turns, running, ask, cancel, reset } = useAgentStream();
  const refresh = useCallback(async () => {
    const [k, d] = await Promise.all([api("/api/workspace/keywords"), api("/api/semantic")]);
    setCatalog(k); setDefinitions(d.definitions); setDates(k.coverage);
  }, []);
  useEffect(() => {
    let mounted = true;
    api("/api/workspace/session").then(async (r) => { if (mounted) setUser(r.user); if (r.user) { await refresh(); const id = new URLSearchParams(window.location.search).get("analysis"); if (id) { const data = await api(`/api/workspace/analyses/${encodeURIComponent(id)}`); if (mounted) setSelected(data.analysis); } } }).catch((e) => setMessage(e.message)).finally(() => setLoading(false));
    return () => { mounted = false; };
  }, [refresh]);
  useEffect(() => {
    if (user && !["new", "dictionary", "settings"].includes(view)) api(`/api/workspace/analyses?view=${view}`).then((r) => setAnalyses(r.analyses)).catch((e) => setMessage(e.message));
  }, [user, view]);
  const latest = turns.at(-1);
  useEffect(() => {
    if (latest?.response && !latest.response.isMock) api(`/api/workspace/analyses/${latest.response.requestId}`).then((r) => setSelected(r.analysis)).catch((e) => setMessage(e.message));
  }, [latest?.response]);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await fn(); } catch (e) { setMessage(e instanceof Error ? e.message : "처리하지 못했습니다."); } finally { setBusy(false); }
  };
  const navigate = (id: string) => { setView(id); setSelected(null); setMessage(""); setMobileNav(false); if (id === "new") { reset(); setDraft(""); window.history.replaceState(null, "", "/"); } };
  const askQuestion = (q: string) => { if (running) return; const prior = selected ? [{ question: selected.response.question, status: selected.response.status, clarificationQuestion: selected.response.status === "needs_clarification" ? selected.response.clarificationQuestion : null, resolution: selected.response.resolution ?? null }] : undefined; setView("new"); setSelected(null); setMessage(""); setDraft(""); ask(q, prior); };
  const action = (name: string, payload?: Record<string, unknown>) => act(async () => {
    const id = selected?.id ?? latest?.response?.requestId;
    if (!id) throw new Error("저장할 분석이 없습니다.");
    if (name === "share" && selected?.shared) { await navigator.clipboard.writeText(`${window.location.origin}/?analysis=${id}`); setMessage("내부 공유 링크를 복사했습니다. 로그인한 워크스페이스 구성원만 열 수 있습니다."); return; }
    const r = await api(`/api/workspace/analyses/${id}${name === "review" ? "/review" : ""}`, name === "review" ? "POST" : "PATCH", payload);
    setSelected(r.analysis);
    setMessage(name === "share" ? "내부 공유를 켰습니다. 버튼을 다시 누르면 링크를 복사합니다." : name === "review" ? "검토 상태와 의견을 기록했습니다." : "분석을 저장했습니다.");
  });
  const compose = (next: typeof choice) => act(async () => {
    setChoice(next);
    setDraft("");
    if (!next.metric || !catalog) return;
    const period = next.period === "available" ? catalog.coverage : dates;
    if (period.start < catalog.coverage.start || period.end > catalog.coverage.end) throw new Error(`가입일은 ${catalog.coverage.start} ~ ${catalog.coverage.end} 안에서 선택해 주세요.`);
    const r = await api("/api/workspace/keywords", "POST", { ...next, ...period }); setDraft(r.question);
  });
  if (loading) return <div className="loading-page"><span className="loading-dot"/> 워크스페이스를 준비하고 있어요.</div>;
  if (!user) return <div className="login-page"><div className="login-brand">MI<span>Marketing Intelligence</span></div><div className="login-card"><span className="badge blue">마케터와 분석가가 함께 쓰는 공간</span><h1>데이터를 질문으로,<br/>질문을 다음 행동으로.</h1><p>업무 언어로 분석하고, 분석가의 검토로<br/>계산 근거를 함께 확인하세요.</p><form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act(async () => { const r = await api("/api/workspace/session", "POST", { email: f.get("email"), password: f.get("password") }); setUser(r.user); await refresh(); }); }}><label>이메일<input name="email" type="email" autoComplete="username" placeholder="발급받은 업무 계정" required/></label><label>비밀번호<input name="password" type="password" autoComplete="current-password" required/></label><button className="primary" disabled={busy}>{busy ? "로그인 중…" : "워크스페이스 시작하기"}</button></form><p className="small muted">계정은 워크스페이스 분석가가 발급합니다.<br/>관리자 토큰 입력은 필요하지 않습니다.</p>{message && <p role="alert" className="notice">{message}</p>}</div><div className="login-footer">질문은 쉽게 · 계산 근거는 분명하게</div></div>;
  const response = selected?.response ?? latest?.response;
  return <div className="workspace-shell">
    <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}><Link className="brand" href="/"><span>MI</span><div>마케팅 인텔리전스<small>우리 팀의 분석 워크스페이스</small></div></Link><nav aria-label="워크스페이스 메뉴">{NAV.map((n) => <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => navigate(n.id)}><span>{n.icon}</span>{n.label}</button>)}</nav><div className="sidebar-bottom"><a href="https://hackathon-journey-dashboard.vercel.app/">고객 여정 대시보드 ↗</a><a href="https://hackathon-journey-dashboard.vercel.app/insights">지표 연관 지도 ↗</a><div className="profile"><span className="avatar">{user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><small>{user.role === "analyst" ? "데이터 분석가" : "마케터"}</small></div><button aria-label="로그아웃" title="로그아웃" onClick={() => act(async () => { await api("/api/workspace/session", "DELETE"); setUser(null); reset(); setSelected(null); })}>↪</button></div></div></aside>
    <div className="workspace-body"><header className="topbar"><button className="mobile-menu icon-button" aria-label="메뉴 열기" onClick={() => setMobileNav(!mobileNav)}>☰</button><div className="project-name">{mode === "mock" ? "가상 예시 분석" : "OTT 고객 분석"} <span className="badge success">{catalog?.connected ? "데이터 연결됨" : "연결 확인 중"}</span></div><div className="topbar-meta"><span>최근 관측일 <strong>{catalog?.latestObservation ?? "확인 중"}</strong></span><span className="role-pill">{user.role === "analyst" ? "데이터 분석가" : "마케터"}</span></div></header>
      <main className="workspace-main">{message && <div className="toast" role="status">{message}<button aria-label="알림 닫기" onClick={() => setMessage("")}>✕</button></div>}
        {view === "new" ? <><div className="page-intro"><span className="eyebrow">우리 팀의 AI 분석 파트너</span><h1>{response || running ? "분석의 근거까지, 함께 확인해요" : `${user.name}님, 무엇이 궁금하세요?`}</h1><p>비즈니스 언어로 질문하세요. 등록된 지표와 실제 데이터로 답을 찾습니다.</p></div>
          {!response && !running && <div className="recommendations">{catalog?.recommendations.map((q, i) => <button key={q} onClick={() => setDraft(q)}><span>추천 질문 {String(i + 1).padStart(2, "0")}</span><strong>{q}</strong><b>↗</b></button>)}</div>}
          {!selected || selected.owner_id === user.id ? <section className="composer-card"><div className="composer-heading"><h2>분석 키워드로 시작하기</h2><span>직접 질문해도 좋아요</span></div>{catalog?.groups.map((g) => <div className="keyword-group" key={g.id}><h3>{g.label}</h3><div className="chips">{g.items.map((k) => <button key={k.id} className={`chip ${choice[g.id as keyof typeof choice] === k.id ? "selected" : ""} ${!k.enabled ? "unavailable" : ""}`} aria-disabled={!k.enabled} title={k.reason} disabled={busy || running} onClick={() => k.enabled ? compose({ ...choice, [g.id]: k.id }) : setMessage(k.reason)}>{k.label}{!k.enabled && <span> · 검토 필요</span>}</button>)}</div></div>)}{choice.period === "custom" && <div className="date-range"><label>가입 시작일<input type="date" min={catalog?.coverage.start} max={catalog?.coverage.end} value={dates.start} onChange={(e) => setDates({ ...dates, start: e.target.value })}/></label><label>가입 종료일<input type="date" min={catalog?.coverage.start} max={catalog?.coverage.end} value={dates.end} onChange={(e) => setDates({ ...dates, end: e.target.value })}/></label><button className="secondary" onClick={() => compose(choice)}>기간 적용</button></div>}
            <form className="question-box" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) askQuestion(draft.trim()); }}><label className="sr-only" htmlFor="workspace-question">분석할 질문</label><textarea id="workspace-question" rows={2} maxLength={500} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="예: 2025년 2월 가입 고객의 D+30 결제 전환율을 연령대별로 비교해줘." onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (draft.trim() && !running) askQuestion(draft.trim()); } }}/><div><span>{catalog ? `가입 데이터 ${catalog.coverage.start} ~ ${catalog.coverage.end}` : "데이터 연결 확인 중"}</span>{running ? <button type="button" className="secondary" onClick={cancel}>분석 중단</button> : <button className="primary" disabled={!draft.trim() || busy}>분석하기 ↑</button>}</div></form>
          </section> : null}
          {running && <div className="progress-card" role="status"><span className="loading-dot"/><div><strong>{STAGES[latest?.stage ?? "resolving"]}</strong><p>계산 조건과 안전성을 단계별로 확인합니다. 자동 검증은 업무상 정답 확정과 별개입니다.</p></div></div>}
          {latest?.error && <p className="notice" role="alert">{latest.error}</p>}
          {response && <ResultView key={response.requestId} response={response} analysis={selected} user={user} onAction={action} onAsk={askQuestion} busy={busy}/>}
          {turns.length > 1 && <details className="past-turns"><summary>이전 질문 {turns.length - 1}개</summary>{turns.slice(0, -1).map((t) => <div key={t.id}><strong>{t.question}</strong><p>{t.response?.status === "passed" ? t.response.answer : t.response?.status === "needs_clarification" ? t.response.clarificationQuestion : "분석 기록"}</p></div>)}</details>}
        </> : view === "dictionary" ? <Dictionary definitions={definitions} user={user} refresh={refresh} onMessage={setMessage}/> : view === "settings" ? <Settings user={user} onMessage={setMessage}/> : <><div className="page-intro"><h1>{NAV.find((n) => n.id === view)?.label}</h1><p>{view === "reviews" ? "질문과 계산 근거를 함께 확인하고 의견을 남겨요." : "분석 결과와 사용한 정의 버전을 다시 확인할 수 있어요."}</p></div><div className="analysis-list">{analyses.length === 0 && <div className="empty-card">아직 분석이 없습니다.<button className="primary" onClick={() => navigate("new")}>첫 분석 시작하기</button></div>}{analyses.map((a) => <button className="analysis-item" key={a.id} onClick={() => act(async () => { const r = await api(`/api/workspace/analyses/${a.id}`); setSelected(r.analysis); })}><div><strong>{a.title}</strong><p>{a.owner_name} · {new Date(a.created_at).toLocaleDateString("ko-KR")}</p></div><span className={`badge ${a.review_status === "approved" ? "success" : ""}`}>{a.review_status ? REVIEW_LABEL[a.review_status] : a.response.status === "passed" ? "자동 검증 통과" : "기준 확인 필요"}</span><span>→</span></button>)}</div>{selected && <ResultView key={selected.id} response={selected.response} analysis={selected} user={user} onAction={action} busy={busy}/>}</>}
      </main><footer className="workspace-footer">관측된 데이터로 답하고, 계산 근거로 신뢰를 쌓습니다.</footer>
    </div>
  </div>;
}

function Settings({ user, onMessage }: { user: User; onMessage: (s: string) => void }) {
  const [users, setUsers] = useState<User[]>([]), [busy, setBusy] = useState(false);
  useEffect(() => { if (user.role === "analyst") api("/api/workspace/users").then((r) => setUsers(r.users)).catch((e) => onMessage(e.message)); }, [user.role, onMessage]);
  return <><div className="page-intro"><h1>워크스페이스 설정</h1><p>역할은 계정에 등록되며 서버에서 확인합니다.</p></div><section className="content-card"><h2>내 계정</h2><p>{user.name} · {user.email} · {user.role === "analyst" ? "데이터 분석가" : "마케터"}</p></section>{user.role === "analyst" && <section className="content-card"><h2>구성원 계정 발급</h2><p className="muted">이 워크스페이스에 접근할 구성원의 계정을 발급하세요. 비밀번호는 최소 12자입니다.</p><form className="account-form" onSubmit={async (e) => { e.preventDefault(); const form = e.currentTarget; const data = new FormData(form); setBusy(true); try { await api("/api/workspace/users", "POST", Object.fromEntries(data)); setUsers((await api("/api/workspace/users")).users); form.reset(); onMessage("계정을 발급했습니다. 구성원에게 로그인 정보를 전달해 주세요."); } catch (err) { onMessage(err instanceof Error ? err.message : "발급에 실패했습니다."); } finally { setBusy(false); } }}><label>이름<input name="name" required minLength={2}/></label><label>이메일<input name="email" type="email" required/></label><label>초기 비밀번호<input name="password" type="password" required minLength={12} autoComplete="new-password"/></label><label>역할<select name="role"><option value="marketer">마케터</option><option value="analyst">데이터 분석가</option></select></label><button className="primary" disabled={busy}>계정 발급</button></form><div className="members">{users.map((u) => <div key={u.id}><strong>{u.name}</strong><span>{u.email}</span><span className="badge">{u.role === "analyst" ? "분석가" : "마케터"}</span></div>)}</div></section>}<section className="content-card"><h2>데이터와 외부 모델</h2><p>OTT 해커톤 데이터의 조회 결과를 표시합니다. SQL 실행은 읽기 전용 계정으로 제한하며 결과 원본 행은 외부 모델에 전달하지 않습니다. 모델에는 질문·업무 정의·테이블 구조·상품 범주값·승인된 SQL 사례가 전달됩니다.</p><p className="muted">내부 공유는 로그인한 구성원에게만 허용됩니다. 개별 고객 식별자가 포함된 결과는 공유할 수 없습니다.</p></section></>;
}
