"use client";
import { useRef, useState } from "react";
import type { AgentResponse, ResultTable } from "@/lib/agent/contract";
import type { Analysis, User } from "@/lib/workspace";
import { REVIEW_LABEL } from "@/lib/workspace";
import { ResultTable as DataTable } from "@/components/chat/ResultTable";
import { SqlBlock } from "@/components/chat/SqlBlock";
import { AttemptLog } from "@/components/chat/AttemptLog";
import { selectChart } from "@/lib/workspaceChart";

const number = (v: unknown) => typeof v === "number" ? v.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : String(v ?? "—");
export function Visualization({ table }: { table: ResultTable }) {
  const chart = selectChart(table);
  if (chart.kind === "kpi") return <div className="kpi-grid">{chart.columns.map((c) => <div className="kpi" key={c.key}><span>{c.label}</span><strong>{number(table.rows[0]?.[c.key])}{c.kind === "percent" ? "%" : ""}</strong></div>)}</div>;
  if (chart.kind === "line") {
    const values = table.rows.map((r) => Number(r[chart.value.key]));
    const max = Math.max(...values, 1), min = Math.min(...values, 0);
    const points = values.map((v, i) => `${30 + i * 580 / Math.max(1, values.length - 1)},${165 - (v - min) / (max - min || 1) * 140}`).join(" ");
    return <figure className="chart"><figcaption>{chart.value.label} · {chart.label.label}별 추이</figcaption><svg viewBox="0 0 640 200" role="img" aria-label={`${chart.value.label} 기간별 추이. 정확한 값은 결과 표에서 확인하세요.`}><line x1="30" y1="165" x2="610" y2="165" stroke="#e5e8eb"/><polyline fill="none" stroke="#3182f6" strokeWidth="3" points={points}/><text x="30" y="192" fontSize="11" fill="#6b7684">{String(table.rows[0][chart.label.key])}</text><text x="610" y="192" textAnchor="end" fontSize="11" fill="#6b7684">{String(table.rows.at(-1)?.[chart.label.key])}</text></svg></figure>;
  }
  if (chart.kind === "bar") {
    const rows = table.rows.slice(0, 12), max = Math.max(...rows.map((r) => Math.abs(Number(r[chart.value.key]))), 1);
    return <figure className="chart"><figcaption>{chart.value.label} 비교{table.rows.length > 12 ? " · 상위 표시 12행" : ""}</figcaption>{rows.map((r, i) => <div className="bar-row" key={i}><span title={String(r[chart.label.key])}>{String(r[chart.label.key] ?? "미상")}</span><div className="bar-track"><div style={{ width: `${Math.abs(Number(r[chart.value.key])) / max * 100}%` }}/></div><strong>{number(r[chart.value.key])}{chart.value.kind === "percent" ? "%" : ""}</strong></div>)}</figure>;
  }
  return <DataTable table={table}/>;
}

export function ResultView({ response: r, analysis, user, onAction, onAsk, busy }: {
  response: AgentResponse; analysis?: Analysis | null; user: User; busy?: boolean;
  onAction: (action: string, payload?: Record<string, unknown>) => void; onAsk?: (q: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
  const [proposedSql, setProposedSql] = useState("");
  const [title, setTitle] = useState(analysis?.title ?? r.question);
  const [requesting, setRequesting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const owner = !analysis || analysis.owner_id === user.id;
  const approved = analysis?.review_status === "approved";
  const suggested = r.status === "passed" ? (r.resolution?.metricIds.includes("signup_customers") ? "같은 가입 기간의 D+30 결제 전환율도 알려줘." : "같은 기준으로 연령대별 차이를 비교해줘.") : null;
  return <article className="result-card">
    <div className="result-heading"><span className={`badge ${approved ? "success" : "blue"}`}>{analysis?.review_status ? REVIEW_LABEL[analysis.review_status] : r.status === "passed" ? "자동 검증 통과" : "분석 기준 확인 필요"}</span><button className="text-button" onClick={() => dialog.current?.showModal()}>분석 근거 보기 ↗</button></div>
    <h2>{analysis?.title ?? r.question}</h2>
    {r.isMock && <p className="notice">가상 예시입니다. 실제 데이터 분석 결과가 아닙니다.</p>}
    {r.status === "passed" ? <>
      <p className="answer">{r.answer}</p>
      <Visualization table={r.table}/>
      <div className="interpretation"><strong>결과를 읽는 방법</strong><p>{r.table.rowCount === 0 ? "선택한 조건에 해당하는 데이터가 없습니다." : r.table.rowCount > 1 ? `조건에 해당하는 ${r.table.rowCount.toLocaleString("ko-KR")}개 결과입니다. 동일한 기간·집계 단위인지 확인한 후 비교해 주세요.` : "선택한 기간과 등록된 계산 조건을 적용한 결과입니다."} {approved ? "분석가가 이 분석의 계산 근거를 승인했습니다." : "SQL 실행과 자동 검증은 통과했습니다. 업무상 정답은 분석가 검토 전입니다."}</p>{r.meta.assumptions.length > 0 && <p>{r.meta.assumptions.join(" · ")}</p>}{r.table.truncated && <p>표시 행 수가 제한되어 있습니다. 전체 결과와 다를 수 있습니다.</p>}</div>
      <details className="table-details"><summary>결과 표 확인 · {r.table.rowCount}행</summary><DataTable table={r.table}/></details>
    </> : <div className="clarification"><p>{r.status === "needs_clarification" ? r.clarificationQuestion : r.message}</p>{r.status === "needs_clarification" && r.resolution?.options.map((o) => <button className="chip" key={o.label} onClick={() => onAsk?.(`${o.label} 기준으로 계산해줘`)}>{o.label}</button>)}{r.status === "failed" && <p className="muted">{r.reasons.join(" · ")}</p>}</div>}
    {!r.isMock && <div className="result-actions">
      {owner && <><button className="secondary" disabled={busy} onClick={() => onAction("save", { saved: !analysis?.saved })}>{analysis?.saved ? "저장됨 ✓" : "분석 저장"}</button><button className="secondary" disabled={busy || r.status !== "passed"} onClick={() => onAction("share", { shared: !analysis?.shared })}>{analysis?.shared ? "공유 링크 복사" : "내부 공유"}</button><button className="primary" disabled={busy || ["requested", "in_review", "approved"].includes(analysis?.review_status ?? "")} onClick={() => setRequesting(!requesting)}>분석가에게 검토 요청</button></>}
      {analysis && r.status === "passed" && <a className="secondary" href={`/api/workspace/analyses/${analysis.id}?format=csv`}>CSV 다운로드</a>}
      {user.role === "analyst" && ["requested", "in_review"].includes(analysis?.review_status ?? "") && <button className="primary" onClick={() => setReviewing(!reviewing)}>분석 검토하기</button>}
    </div>}
    {requesting && <form className="review-form" onSubmit={(e) => { e.preventDefault(); onAction("review", { status: "requested", message, proposedSql: null }); setRequesting(false); }}><label>분석가가 확인할 내용을 알려 주세요<textarea required minLength={2} maxLength={3000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="예: 결제 전환율의 분모와 관측 기간을 확인해 주세요."/></label><button className="primary" disabled={busy}>검토 요청 보내기</button></form>}
    {reviewing && <div className="review-form"><h3>계산 근거 검토</h3><p className="muted">공식 지표와 아래 분석 근거를 비교해 주세요. 수정 SQL은 제안으로 보관하며 다시 실행·검증하기 전에는 승인할 수 없습니다.</p><label>수정 SQL 제안<textarea value={proposedSql} onChange={(e) => setProposedSql(e.target.value)} placeholder="수정이 필요한 경우 SQL을 제안해 주세요."/></label>{r.status === "passed" && proposedSql && <div className="sql-compare"><div><h4>원본 SQL</h4><SqlBlock sql={r.sql}/></div><div><h4>수정 제안 SQL</h4><SqlBlock sql={proposedSql}/></div></div>}<label>검토 의견<textarea value={message} maxLength={3000} onChange={(e) => setMessage(e.target.value)} placeholder="수정 이유 또는 승인 근거를 한국어로 작성해 주세요."/></label><div className="result-actions">{(["in_review", "changes_requested", "approved", "rejected"] as const).map((s) => <button key={s} className={s === "approved" ? "primary" : "secondary"} disabled={busy || message.trim().length < 2 || s === analysis?.review_status} onClick={() => onAction("review", { status: s, message, proposedSql: proposedSql || null })}>{REVIEW_LABEL[s]}</button>)}</div></div>}
    {analysis?.events && analysis.events.length > 0 && <div className="review-history"><h3>검토 의견</h3>{analysis.events.map((e) => <div key={e.id}><span className="badge">{REVIEW_LABEL[e.status]}</span><strong>{e.actor_name}</strong><time>{new Date(e.created_at).toLocaleString("ko-KR")}</time><p>{e.message}</p>{e.proposed_sql && <details><summary>수정 SQL 제안</summary><SqlBlock sql={e.proposed_sql}/></details>}</div>)}</div>}
    {owner && suggested && onAsk && <button className="followup" onClick={() => onAsk(suggested)}>이어서 분석하기 · {suggested} →</button>}
    <dialog ref={dialog} className="evidence-dialog"><div className="drawer-header"><h2>분석 근거</h2><button aria-label="분석 근거 닫기" className="icon-button" onClick={() => dialog.current?.close()}>✕</button></div>
      {analysis && owner && <form onSubmit={(e) => { e.preventDefault(); onAction("rename", { title }); }} className="rename-form"><label>분석 제목<input value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)}/></label><button className="secondary">변경</button></form>}
      {r.status === "passed" && <><dl className="evidence-grid"><div><dt>사용 지표</dt><dd>{r.meta.metrics.join(" · ")}</dd></div><div><dt>적용 기간</dt><dd>{r.meta.period ?? "전체 관측 기간"}</dd></div><div><dt>SQL 실행</dt><dd>성공 · 읽기 전용 조회</dd></div><div><dt>정답 확인</dt><dd>{approved ? "분석가 승인" : r.meta.groundTruth === "gold_verified" ? "기준 정답과 비교 완료" : "분석가 검토 전"}</dd></div></dl><h3>계산식과 조건</h3><p>{r.meta.definition?.formula ?? "지표 정의를 참조해 계산했습니다."}</p><p>{r.meta.definition?.filters.join(" · ")}</p><h3>데이터 출처</h3><p>{r.meta.sources.join(" · ")}</p><p className="muted">테이블별 관측 기간이 다릅니다. 결과의 차이는 인과관계를 의미하지 않습니다.</p><h3>사용한 정의 버전</h3>{analysis?.definitions.map((d) => <details key={d.id}><summary>{d.name} · v{d.version} · {d.authority === "official" ? "공식" : "후보"}</summary><p>{d.description}</p><p>{d.rule}</p><p>{d.caveat}</p></details>)}<h3>SQL 코드</h3><SqlBlock sql={r.sql}/></>}
      <h3>검증 결과</h3><AttemptLog attempts={r.attempts}/>
    </dialog>
  </article>;
}
