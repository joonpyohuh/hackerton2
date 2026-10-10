import { motion } from "framer-motion";
import { useState } from "react";
import { IMP_COLOR, IMP_LABEL, factSentence, fmt, importanceOf, pText, pct, strengthNum, signed } from "../format";
import type { Finding, REdge, RNode } from "../types";
import { Gauge, Mosaic } from "../viz/MiniViz";

interface Props {
  edge: REdge;
  nodeMap: Map<string, RNode>;
  alpha: number;
  findings: Finding[];
  onBack: () => void;
}

const ease = [0.22, 1, 0.36, 1] as const;

export function EdgeDetail({ edge, nodeMap, alpha, findings, onBack }: Props) {
  const [flip, setFlip] = useState(false);
  const A = nodeMap.get(flip ? edge.target : edge.source)?.label ?? "";
  const B = nodeMap.get(flip ? edge.source : edge.target)?.label ?? "";
  const s = factSentence(edge, nodeMap, flip);
  const yes = flip ? edge.p_a_given_b : edge.p_b_given_a;
  const no = flip ? edge.p_a_given_not_b : edge.p_b_given_not_a;
  const t = edge.table;
  const mosaicEdge: REdge = flip
    ? { ...edge, p_a: edge.p_b, p_b_given_a: edge.p_a_given_b, p_b_given_not_a: edge.p_a_given_not_b,
        table: { both: t.both, a_only: t.b_only, b_only: t.a_only, neither: t.neither } }
    : edge;

  return (
    <motion.div key={edge.id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, ease }}>
      <button type="button" onClick={onBack} className="mb-5 cursor-pointer text-[14px] text-muted underline underline-offset-[3px] hover:text-ink">← AI 분석으로 돌아가기</button>
      <div className="eyebrow">{edge.population === "payers" ? `결제 고객 ${fmt(edge.n)}명 기준` : `가입 고객 ${fmt(edge.n)}명 기준`}</div>
      <h2 className="mt-2 text-[20px] font-bold leading-[1.3] tracking-[-0.03em]">
        {A} <span className="font-normal text-muted">↔</span> {B}
      </h2>

      <div className="mt-4 inline-flex border border-axis text-[14px]" role="tablist" aria-label="읽는 방향">
        {[false, true].map((f) => (
          <button key={String(f)} type="button" role="tab" aria-selected={flip === f} onClick={() => setFlip(f)}
            className={`cursor-pointer px-2.5 py-1 ${flip === f ? "bg-ink text-bg" : "text-ink-2"} ${f ? "border-l border-axis" : ""}`}>
            {nodeMap.get(f ? edge.target : edge.source)?.label} 기준
          </button>
        ))}
      </div>

      <p className="mt-5 text-[17px] font-semibold leading-[1.55] tracking-[-0.02em]">{s.lead}</p>
      <p className="text-[15px] leading-[1.6] text-ink-2">{s.diff}</p>

      <div className="mt-5 grid gap-2">
        {([[A, yes, true], [`${A} 아님`, no, false]] as const).map(([k, v, hi]) => (
          <div key={k + String(flip)} className="grid grid-cols-[1fr_52px] items-end gap-3">
            <div>
              <div className="mb-1 truncate text-[13px] text-ink-2">{k}</div>
              <div className="h-9 bg-hair">
                <motion.div className="h-full rounded-r-[3px]" style={{ background: hi ? IMP_COLOR[importanceOf(edge.phi)] : "var(--bar-2)" }}
                  initial={{ width: 0 }} animate={{ width: `${v * 100}%` }} transition={{ duration: 0.8, ease }} />
              </div>
            </div>
            <div className={`num text-right text-[17px] tracking-[-0.02em] ${hi ? "font-semibold" : "text-ink-2"}`}>{pct(v)}%</div>
          </div>
        ))}
      </div>

      <div className="mt-7 grid grid-cols-2 items-center gap-4 border-t border-ink pt-4">
        <Gauge phi={edge.phi} large />
        <dl className="grid gap-2 text-[14px]">
          <div><dt className="text-muted">연관 강도</dt><dd className="text-[18px] font-semibold tracking-[-0.03em]">{IMP_LABEL[importanceOf(edge.phi)]} <span className="text-[14px] font-normal text-ink-2">{edge.phi >= 0 ? "같이 늘어남" : "반대로 움직임"}</span></dd></div>
          <div><dt className="text-muted">평균보다</dt><dd className="num text-[18px] font-semibold tracking-[-0.03em]">{edge.lift.toFixed(1)}배</dd></div>
        </dl>
      </div>

      <section className="mt-6">
        <h3 className="mb-2 text-[13px] font-medium tracking-[0.06em] text-muted">고객 수로 나눠 보기</h3>
        <Mosaic edge={mosaicEdge} a={A} b={B} />
        <table className="mt-3 w-full border-collapse text-[14px]">
          <thead><tr className="border-b border-ink text-left text-[13px] text-muted"><th className="py-1.5 font-medium" /><th className="py-1.5 text-right font-medium">{B}</th><th className="py-1.5 text-right font-medium">{B} 아님</th></tr></thead>
          <tbody className="num">
            <tr className="border-b border-hair"><td className="py-1.5 text-ink-2">{A}</td><td className="text-right">{fmt(t.both)}</td><td className="text-right">{fmt(flip ? t.b_only : t.a_only)}</td></tr>
            <tr className="border-b border-hair"><td className="py-1.5 text-ink-2">{A} 아님</td><td className="text-right">{fmt(flip ? t.a_only : t.b_only)}</td><td className="text-right">{fmt(t.neither)}</td></tr>
          </tbody>
        </table>
      </section>

      <section className="mt-6">
        <details><summary className="cursor-pointer text-[13px] font-medium tracking-[0.06em] text-muted">통계 상세 보기</summary>
        <dl className="mt-2 grid grid-cols-[1fr_auto] text-[14px] [&>dd]:border-b [&>dd]:border-hair [&>dd]:py-1.5 [&>dd]:text-right [&>dt]:border-b [&>dt]:border-hair [&>dt]:py-1.5 [&>dt]:text-ink-2">
          <dt>연관 강도 (φ, 0~1)</dt><dd className="num">{strengthNum(edge.phi)}</dd>
          <dt>차이 ({A} 기준)</dt><dd className="num">{signed((yes - no) * 100)}%p</dd>
          <dt>χ² 검정값</dt><dd className="num">{edge.chi2.toFixed(1)}</dd>
          <dt>우연일 확률 (p)</dt><dd className="num">{pText(edge.p_value)}</dd>
          <dt>판단 기준 (여러 번 비교 보정)</dt><dd className="num">{alpha.toExponential(1)}</dd>
          <dt>결론</dt><dd className={edge.significant ? "font-semibold" : "text-muted"}>{edge.significant ? "우연이 아님" : edge.reliable ? "우연일 수 있음" : "고객 수가 너무 적음"}</dd>
          <dt>칸별 최소 예상 고객 수</dt><dd className="num">{edge.min_expected.toFixed(0)}</dd>
        </dl></details>
      </section>

      <section className="mt-6">
        <h3 className="mb-2 text-[13px] font-medium tracking-[0.06em] text-muted">읽을 때 주의할 점</h3>
        <ul className="grid gap-1.5 text-[14px] leading-[1.6] text-ink-2">
          <li>— 함께 나타난다는 뜻이지, 하나가 다른 하나를 ‘일으킨다’는 뜻은 아니에요.</li>
          {edge.caveats.map((c) => <li key={c}>— {c}</li>)}
        </ul>
      </section>

      {findings.length > 0 && (
        <section className="mt-6 border-l-2 border-accent pl-3">
          <h3 className="mb-1 text-[13px] font-medium tracking-[0.06em] text-accent">이 연결로 AI가 찾은 사실</h3>
          {findings.map((f) => <p key={f.title} className="mt-1 text-[14px] leading-[1.6]"><b className="font-semibold">{f.title}</b> — {f.fact}</p>)}
        </section>
      )}
    </motion.div>
  );
}
