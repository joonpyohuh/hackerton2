// 모든 지표는 필터된 고객 인덱스 배열에서 매번 재계산한다 (50k 루프, 수 ms).
const D = window.DATA;
const C = D.cols;
const N = C.sd.length;
const PW = D.payWindow; // 30
const bit = (k) => 1 << D.behaviors.indexOf(k);
const VOUCHER = bit("VOUCHER_VIEW");
const SEARCH = bit("SEARCH_OPEN") | bit("SEARCH_SUBMIT") | bit("SEARCH_CONTENT_CLICK") | bit("SEARCH_MORE_CLICK");
const MAXDAY = Math.max(...C.sd);

const BEH_KO = {
  HOME_VISIT: "홈 방문", CATEGORY_VISIT: "카테고리 방문", VOUCHER_VIEW: "이용권 페이지 방문",
  SEARCH_OPEN: "검색 진입", SEARCH_SUBMIT: "검색 실행", SEARCH_CONTENT_CLICK: "검색 결과 클릭",
  SEARCH_MORE_CLICK: "검색 더보기", DETAIL_PLAY_CLICK: "상세 → 재생", CONTENT_PURCHASE_CLICK: "개별 구매 클릭",
  DETAIL_ZZIM: "찜", DETAIL_MORE: "상세 더보기", RECOMMEND_CONTENT_CLICK: "추천 콘텐츠 클릭",
  DETAIL_LIST_CLICK: "상세 목록 클릭", CONTINUOUS_AUTOPLAY: "연속재생", NEXT_EPISODE_CLICK: "다음 회차 클릭",
};
const DEV_KO = { mobile: "mobile", android: "android", ios: "ios", pc: "pc" };
const AGE_KO = (a) => ({ UNDER_14: "14세 미만", "70_PLUS": "70+", UNKNOWN: "미상" }[a] || a.replace("_", "–"));

// ── 날짜 유틸 ───────────────────────────────
// UTC로 고정해 로컬 타임존(KST) 때문에 하루 밀리는 문제를 막는다
const base = Date.parse(D.base + "T00:00:00Z");
const dayToStr = (d) => new Date(base + d * 864e5).toISOString().slice(0, 10);
const strToDay = (s) => Math.round((Date.parse(s + "T00:00:00Z") - base) / 864e5);
const fmt = (n) => n.toLocaleString("ko-KR");
const pct = (a, b, d = 1) => (b ? ((a / b) * 100).toFixed(d) : "—");
const $ = (id) => document.getElementById(id);

// ── 상태 ─────────────────────────────────────
const state = { from: 0, to: MAXDAY, dev: "all", age: "all", gen: "all", push: "all", dim: "dev" };

function select() {
  const out = [];
  const { from, to } = state;
  const dev = state.dev === "all" ? -1 : +state.dev, age = state.age === "all" ? -1 : +state.age;
  const gen = state.gen === "all" ? -1 : +state.gen, push = state.push === "all" ? -1 : +state.push;
  for (let i = 0; i < N; i++) {
    const s = C.sd[i];
    if (s < from || s > to) continue;
    if (dev >= 0 && C.dev[i] !== dev) continue;
    if (age >= 0 && C.age[i] !== age) continue;
    if (gen >= 0 && C.gen[i] !== gen) continue;
    if (push >= 0 && C.push[i] !== push) continue;
    out.push(i);
  }
  return out;
}

const paid = (i, n = PW) => C.fp[i] >= 0 && C.fp[i] <= n;

// ── 타깃 정의 (SQL과 1:1) ───────────────────
const TARGETS = [
  {
    id: "T1", goal: "목적 3 · 첫 결제 전환",
    name: "이용권은 봤지만 결제하지 않은 고객",
    def: "D0~D30 이용권 페이지(VOUCHER_VIEW)를 1회 이상 방문했으나 D0~D30 첫 결제가 없는 고객. 구매 의도는 확인됐고 마지막 한 걸음이 비어 있는 구간.",
    rateLabel: "이용권 관심 → 미결제율",
    test: (i) => (C.bm[i] & VOUCHER) && !paid(i),
    denom: (i) => (C.bm[i] & VOUCHER) > 0,
    sql: `WITH first_pay AS (
  SELECT user_key, relative_signup_day AS fp_day
  FROM payment_fact
  WHERE payment_order = 1
)
SELECT u.user_key, u.push_opt_in_current
FROM user_dim u
LEFT JOIN first_pay f ON f.user_key = u.user_key
WHERE u.signup_date BETWEEN :start_date AND :end_date
  AND EXISTS (
    SELECT 1 FROM behavior_fact b
    WHERE b.user_key = u.user_key
      AND b.behavior_type = 'VOUCHER_VIEW'
      AND b.relative_signup_day BETWEEN 0 AND 30)
  AND (f.fp_day IS NULL OR f.fp_day > 30);
-- 푸시 도달: AND u.push_opt_in_current = 1`,
  },
  {
    id: "T2", goal: "목적 4 · 결제 후 초기 시청 활성화",
    name: "결제하고 7일간 아무것도 보지 않은 고객",
    def: "D0~D30 첫 결제 후, 결제일부터 D+7까지 watch_daily_fact 기록이 없는 고객. 돈은 냈지만 가치를 경험하지 못해 첫 갱신에서 이탈할 위험이 가장 큼.",
    rateLabel: "초기 시청 실패율",
    test: (i) => paid(i) && !C.a7[i],
    denom: (i) => paid(i),
    sql: `WITH first_pay AS (
  SELECT user_key, relative_signup_day AS fp_day
  FROM payment_fact
  WHERE payment_order = 1
    AND relative_signup_day BETWEEN 0 AND 30
)
SELECT u.user_key, u.push_opt_in_current
FROM user_dim u
JOIN first_pay f ON f.user_key = u.user_key
WHERE u.signup_date BETWEEN :start_date AND :end_date
  AND NOT EXISTS (
    SELECT 1 FROM watch_daily_fact w
    WHERE w.user_key = u.user_key
      AND w.relative_signup_day BETWEEN f.fp_day AND f.fp_day + 7);`,
  },
  {
    id: "T3", goal: "목적 5 · 지속 시청 유지",
    name: "초반엔 봤는데 4주차에 사라진 고객",
    def: "D0~D30 첫 결제 후 D+7 안에 시청했지만, D+22~D+28에는 시청 기록이 없는 고객. 활성화는 성공했으나 습관으로 이어지지 못한 구간.",
    rateLabel: "활성화 고객 중 미유지율",
    test: (i) => paid(i) && C.a7[i] && !C.ret[i],
    denom: (i) => paid(i) && C.a7[i] === 1,
    sql: `WITH first_pay AS (
  SELECT user_key, relative_signup_day AS fp_day
  FROM payment_fact
  WHERE payment_order = 1
    AND relative_signup_day BETWEEN 0 AND 30
)
SELECT u.user_key, u.push_opt_in_current
FROM user_dim u
JOIN first_pay f ON f.user_key = u.user_key
WHERE u.signup_date BETWEEN :start_date AND :end_date
  AND EXISTS (
    SELECT 1 FROM watch_daily_fact w
    WHERE w.user_key = u.user_key
      AND w.relative_signup_day BETWEEN f.fp_day AND f.fp_day + 7)
  AND NOT EXISTS (
    SELECT 1 FROM watch_daily_fact w
    WHERE w.user_key = u.user_key
      AND w.relative_signup_day BETWEEN f.fp_day + 22 AND f.fp_day + 28);`,
  },
];

// ── 집계 ─────────────────────────────────────
function compute(ids) {
  const m = { n: ids.length, explore: 0, voucher: 0, p7: 0, p14: 0, p30: 0, a7: 0, a14: 0, a28: 0, ret: 0, V: 0, M: 0, L: 0 };
  for (const i of ids) {
    if (C.bm[i]) m.explore++;
    if (C.bm[i] & VOUCHER) m.voucher++;
    const f = C.fp[i];
    if (f >= 0 && f <= 7) m.p7++;
    if (f >= 0 && f <= 14) m.p14++;
    if (f >= 0 && f <= 30) {
      m.p30++; m.a7 += C.a7[i]; m.a14 += C.a14[i]; m.a28 += C.a28[i]; m.ret += C.ret[i];
    }
    const ch = C.ch[i];
    if (ch & 1) m.V++; if (ch & 2) m.M++; if (ch & 4) m.L++;
  }
  m.fail7 = m.p30 - m.a7;
  m.targets = TARGETS.map((t) => {
    const list = [];
    let den = 0, push = 0;
    for (const i of ids) {
      if (t.denom(i)) den++;
      if (t.test(i)) { list.push(i); if (C.push[i]) push++; }
    }
    return { ...t, list, den, push };
  });
  return m;
}

// ── 렌더: Hero ──────────────────────────────
function renderHero(m) {
  const reach = m.targets.reduce((s, t) => s + t.push, 0);
  $("hero").innerHTML = `
    <div><div class="k">전체 가입 고객</div><div class="v num">${fmt(m.n)}</div><div class="s">${dayToStr(state.from)} — ${dayToStr(state.to)}</div></div>
    <div><div class="k">D+30 결제 전환율</div><div class="v num">${pct(m.p30, m.n)}<small>%</small></div><div class="s">${fmt(m.p30)}명 첫 결제</div></div>
    <div><div class="k">D+22~28 시청 유지율</div><div class="v num">${pct(m.ret, m.p30)}<small>%</small></div><div class="s">첫 결제 고객 ${fmt(m.p30)}명 기준</div></div>
    <div><div class="k">푸시 도달 가능 타깃</div><div class="v num acc">${fmt(reach)}</div><div class="s">타깃 3개 합 · 수신 동의 고객</div></div>`;
  $("meta").innerHTML = `데이터 가입일 ${dayToStr(0)} — ${dayToStr(MAXDAY)}<br>전체 ${fmt(N)}명 중 ${fmt(m.n)}명 선택`;
}

// ── 렌더: Funnel ────────────────────────────
function renderFunnel(m) {
  const st = [
    ["가입", "user_dim", m.n],
    ["서비스 탐색", "D0~D30 행동 1건+", m.explore],
    ["이용권 관심", "VOUCHER_VIEW", m.voucher],
    ["첫 결제", "D0~D30 payment_order=1", m.p30],
    ["초기 시청", "결제 후 D+7 내 시청", m.a7],
    ["지속 시청", "결제 후 D+22~28 시청", m.ret],
  ];
  const steps = st.map((s, k) => (k ? s[2] / (st[k - 1][2] || 1) : 1));
  let worst = 1;
  for (let k = 2; k < steps.length; k++) if (steps[k] < steps[worst]) worst = k;
  $("funnel").innerHTML = st.map(([name, src, v], k) => `
    <div class="fr ${k === worst ? "btl" : ""}">
      <div class="lab"><b>${name}${k === worst ? '<span class="flag">병목</span>' : ""}</b><span>${src}</span></div>
      <div class="track"><div class="fill" style="width:${m.n ? (v / m.n) * 100 : 0}%"></div></div>
      <div class="cnt num">${fmt(v)}<span>${pct(v, m.n)}%</span></div>
      <div class="step">${k ? `전 단계 대비 <b class="num">${pct(v, st[k - 1][2])}%</b>` : ""}</div>
    </div>`).join("");
}

// ── 렌더: KPI grid ──────────────────────────
function renderKpis(m) {
  const t = m.targets;
  const cell = (k, v, s) => `<div><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`;
  const tri = (k, items, s) => `<div><div class="k">${k}</div><div class="tri">${items.map(([a, b]) => `<div><span>${a}</span><b class="num">${b}</b></div>`).join("")}</div><div class="s">${s}</div></div>`;
  $("kgrid").innerHTML = [
    cell("① 전체 가입 고객", fmt(m.n), "선택 기간·세그먼트"),
    cell("② 탐색 행동 경험", `${fmt(m.explore)} <small>${pct(m.explore, m.n)}%</small>`, "D0~D30 behavior_fact 1건+"),
    cell("③ 이용권 페이지 방문", `${fmt(m.voucher)} <small>${pct(m.voucher, m.n)}%</small>`, "VOUCHER_VIEW 경험"),
    tri("④ 첫 결제 전환율", [["D+7", pct(m.p7, m.n) + "%"], ["D+14", pct(m.p14, m.n) + "%"], ["D+30", pct(m.p30, m.n) + "%"]], "÷ 전체 가입 고객"),
    tri("⑤ 결제 후 시청 활성화율", [["D+7", pct(m.a7, m.p30) + "%"], ["D+14", pct(m.a14, m.p30) + "%"], ["D+28", pct(m.a28, m.p30) + "%"]], "÷ D0~D30 첫 결제 고객"),
    cell("⑥ 초기 시청 실패", `${fmt(m.fail7)} <small>${pct(m.fail7, m.p30)}%</small>`, "결제 후 D+7 시청 없음"),
    cell("⑦ D+22~28 시청 유지율", `${pct(m.ret, m.p30)}<small>%</small>`, `${fmt(m.ret)}명 유지`),
    tri("⑧ 유형별 이용률", [["VOD", pct(m.V, m.n) + "%"], ["영화", pct(m.M, m.n) + "%"], ["LIVE", pct(m.L, m.n) + "%"]], "D0~D60 시청 ÷ 가입 고객"),
    cell("⑨ 마케팅 타깃 합계", fmt(t.reduce((s, x) => s + x.list.length, 0)), t.map((x) => `${x.id} ${fmt(x.list.length)}`).join(" · ")),
    cell("⑩ 푸시 도달 가능 타깃", fmt(t.reduce((s, x) => s + x.push, 0)), t.map((x) => `${x.id} ${fmt(x.push)}`).join(" · ")),
  ].join("");
}

// ── 렌더: Segment table ─────────────────────
const DIMS = {
  dev: { label: "가입 기기", key: (i) => D.devices[C.dev[i]] },
  age: { label: "연령대", key: (i) => AGE_KO(D.ages[C.age[i]]), order: D.ages.map(AGE_KO) },
  gen: { label: "성별코드", key: (i) => "코드 " + C.gen[i] },
  push: { label: "푸시 수신", key: (i) => (C.push[i] ? "수신 가능" : "수신 불가") },
  week: { label: "가입 주차", key: (i) => { const w = Math.floor(C.sd[i] / 7); return `${dayToStr(w * 7).slice(5)} 주`; } },
  beh: {
    label: "탐색 행동", key: (i) => {
      const b = C.bm[i];
      if (!b) return "탐색 없음";
      if (b & VOUCHER) return "이용권 페이지 방문";
      if (b & SEARCH) return "검색 (이용권 X)";
      return "홈·카테고리만";
    }, order: ["탐색 없음", "홈·카테고리만", "검색 (이용권 X)", "이용권 페이지 방문"],
  },
  ch: {
    label: "콘텐츠 유형", key: (i) => {
      const c = C.ch[i];
      if (!c) return "시청 없음";
      const s = [c & 1 && "VOD", c & 2 && "영화", c & 4 && "LIVE"].filter(Boolean);
      return s.length > 1 ? "복합 (" + s.join("+") + ")" : s[0] + " 단독";
    },
  },
  genre: { label: "주 시청 장르", key: (i) => (C.tg[i] < 0 ? "시청 없음" : D.genres[C.tg[i]]) },
  prod: { label: "이용권 상품", payersOnly: true, key: (i) => (C.prod[i] < 0 ? null : D.products[C.prod[i]]) },
  auto: { label: "자동결제", payersOnly: true, key: (i) => (C.auto[i] < 0 ? null : C.auto[i] ? "자동결제" : "단건결제") },
};

function renderDims() {
  $("dims").innerHTML = Object.entries(DIMS).map(([k, d]) => `<button data-d="${k}" class="${k === state.dim ? "on" : ""}">${d.label}</button>`).join("");
}

function renderSeg(ids) {
  const dim = DIMS[state.dim];
  const g = new Map();
  for (const i of ids) {
    if (dim.payersOnly && !paid(i)) continue;
    const k = dim.key(i);
    if (k == null) continue;
    let r = g.get(k);
    if (!r) g.set(k, (r = { n: 0, p30: 0, a7: 0, ret: 0 }));
    r.n++;
    if (paid(i)) { r.p30++; r.a7 += C.a7[i]; r.ret += C.ret[i]; }
  }
  let rows = [...g.entries()].map(([k, r]) => ({ k, ...r, conv: r.p30 / r.n, act: r.p30 ? r.a7 / r.p30 : 0, rt: r.p30 ? r.ret / r.p30 : 0 }));
  if (dim.order) rows.sort((a, b) => dim.order.indexOf(a.k) - dim.order.indexOf(b.k));
  else if (state.dim !== "week") rows.sort((a, b) => b.n - a.n);
  else rows.sort((a, b) => (a.k < b.k ? -1 : 1));
  const total = rows.reduce((s, r) => s + r.n, 0);
  const minN = 30; // 소표본 강조 제외
  const best = (f) => Math.max(...rows.filter((r) => r.p30 >= minN || f === "conv").map((r) => r[f]));
  const mx = { conv: best("conv"), act: best("act"), rt: best("rt") };
  const bar = (v, f, small) => small ? `<span class="dim">n&lt;${minN}</span>` :
    `<div class="mbar ${v === mx[f] ? "hi" : ""}"><i style="width:${v * 140}px"></i><em>${(v * 100).toFixed(1)}%</em></div>`;
  const convCol = !dim.payersOnly;
  $("segtable").innerHTML = `
    <thead><tr><th>${dim.label}</th><th class="n">고객 수</th><th class="n">비중</th>
      ${convCol ? "<th>D+30 결제 전환율</th>" : ""}<th>D+7 시청 활성화율</th><th>D+22~28 유지율</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${r.k}</td><td class="n">${fmt(r.n)}</td><td class="n dim">${pct(r.n, total)}%</td>
      ${convCol ? `<td>${bar(r.conv, "conv")}</td>` : ""}<td>${bar(r.act, "act", r.p30 < minN)}</td><td>${bar(r.rt, "rt", r.p30 < minN)}</td></tr>`).join("")}
    </tbody>`;
  if (dim.payersOnly) $("segtable").insertAdjacentHTML("beforeend", `<caption style="caption-side:bottom;text-align:left;font-size:11px;color:var(--muted);padding-top:8px">결제 속성이라 D0~D30 첫 결제 고객만 집계 (전환율 열 없음)</caption>`);
}

// ── 렌더: Behavior lift ─────────────────────
function renderBehav(ids) {
  let np = 0, pp = 0;
  const cp = new Array(D.behaviors.length).fill(0), cn = cp.slice();
  for (const i of ids) {
    const p = paid(i), b = C.bpre[i];
    p ? pp++ : np++;
    for (let k = 0; k < D.behaviors.length; k++) if (b & (1 << k)) (p ? cp : cn)[k]++;
  }
  const rows = D.behaviors.map((b, k) => ({ b, p: pp ? cp[k] / pp : 0, n: np ? cn[k] / np : 0 }))
    .filter((r) => r.p + r.n > 0.005)
    .map((r) => ({ ...r, lift: r.n ? r.p / r.n : 0 }))
    .sort((a, b) => b.lift - a.lift);
  const maxV = Math.max(...rows.map((r) => Math.max(r.p, r.n)), 0.01);
  $("behav").innerHTML = rows.map((r, k) => `
    <div class="br" title="결제 ${(r.p * 100).toFixed(1)}% · 미결제 ${(r.n * 100).toFixed(1)}%">
      <div class="nm">${BEH_KO[r.b]}<span>${r.b}</span></div>
      <div class="bars"><i style="width:${(r.p / maxV) * 100}%;background:var(--bar)"></i><i style="width:${(r.n / maxV) * 100}%;background:var(--bar-2)"></i></div>
      <div class="lift ${k < 3 ? "hi" : ""}">×${r.lift.toFixed(1)}</div>
    </div>`).join("");
}

// ── 렌더: Trend (가입일별 D+30 전환율) ───────
function renderTrend(ids) {
  const byDay = new Map();
  for (const i of ids) {
    const d = C.sd[i];
    let r = byDay.get(d);
    if (!r) byDay.set(d, (r = { n: 0, p: 0 }));
    r.n++; if (paid(i)) r.p++;
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const W = 1000, H = 220, pl = 36, pb = 24, pt = 8;
  const span = Math.max(state.to - state.from + 1, 1);
  const bw = (W - pl) / span;
  const maxR = Math.max(0.4, ...days.map((d) => byDay.get(d).p / byDay.get(d).n));
  const y = (v) => pt + (H - pt - pb) * (1 - v / maxR);
  const ticks = [0, 0.1, 0.2, 0.3, 0.4, 0.5].filter((t) => t <= maxR);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="가입일별 D+30 결제 전환율">`;
  svg += ticks.map((t) => `<line x1="${pl}" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="var(--hair)" stroke-width="1"/><text class="tick" x="${pl - 8}" y="${y(t) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${t * 100}%</text>`).join("");
  svg += `<line x1="${pl}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/>`;
  for (const d of days) {
    const r = byDay.get(d), v = r.p / r.n, x = pl + (d - state.from) * bw;
    const w = Math.max(bw - 2, 1);
    svg += `<rect x="${x + 1}" y="${y(v)}" width="${w}" height="${y(0) - y(v)}" fill="var(--bar)" rx="${Math.min(2, w / 2)}" data-d="${d}"/>`;
    svg += `<rect x="${x}" y="${pt}" width="${bw}" height="${H - pt - pb}" fill="transparent" data-d="${d}" class="hit"/>`;
  }
  const lblEvery = Math.ceil(span / 10);
  for (let d = state.from; d <= state.to; d += lblEvery)
    svg += `<text class="tick" x="${pl + (d - state.from) * bw + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${dayToStr(d).slice(5)}</text>`;
  svg += `</svg>`;
  const el = $("trend");
  el.innerHTML = svg + `<div class="tip" id="tip"></div>`;
  const tip = $("tip");
  el.querySelectorAll(".hit").forEach((h) => {
    h.addEventListener("mousemove", (e) => {
      const d = +h.dataset.d, r = byDay.get(d);
      tip.innerHTML = `${dayToStr(d)}<br>가입 ${fmt(r.n)} · 전환 ${pct(r.p, r.n)}%`;
      const box = el.getBoundingClientRect();
      tip.style.left = Math.min(e.clientX - box.left + 12, box.width - 150) + "px";
      tip.style.top = e.clientY - box.top - 44 + "px";
      tip.style.opacity = 1;
    });
    h.addEventListener("mouseleave", () => (tip.style.opacity = 0));
  });
}

// ── 렌더: Targets ───────────────────────────
function topGenres(list, k = 3) {
  const cnt = new Map();
  let w = 0;
  for (const i of list) { const g = C.tg[i]; if (g < 0 || D.genres[g] === "기타") continue; w++; cnt.set(g, (cnt.get(g) || 0) + 1); }
  return { w, top: [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([g, c]) => [D.genres[g], c]) };
}
function topProducts(ids, k = 3) {
  const cnt = new Map(); let n = 0;
  for (const i of ids) { if (!paid(i) || !C.ret[i]) continue; n++; const p = D.products[C.prod[i]]; cnt.set(p, (cnt.get(p) || 0) + 1); }
  return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([p, c]) => [p, pct(c, n)]);
}

function renderTargets(m, ids) {
  const prodTop = topProducts(ids);
  const order = [...m.targets].sort((a, b) => b.push - a.push);
  $("targets").innerHTML = m.targets.map((t) => {
    const g = topGenres(t.list);
    const titles = g.top.length ? (D.reco[g.top[0][0]] || []).slice(0, 3) : D.reco._all.slice(0, 3);
    const rank = order.indexOf(t) + 1;
    return `<div class="tg">
      <div class="pr">${t.id}<b>${rank}</b>도달 순위</div>
      <div>
        <div class="goal">${t.goal}</div>
        <h3>${t.name}</h3>
        <p class="def">${t.def}</p>
        <div class="nums">
          <div><span>대상 고객</span><b class="num">${fmt(t.list.length)}</b></div>
          <div><span>${t.rateLabel}</span><b class="num">${pct(t.list.length, t.den)}%</b></div>
          <div><span>푸시 도달 가능</span><b class="num acc">${fmt(t.push)}</b></div>
        </div>
        <div class="actions">
          <button class="btn" data-ai-target="${t.id}" type="button">✦ GPT 전략</button>
        </div>
        <details><summary>추출 SQL</summary><pre>${t.sql.replace(/</g, "&lt;")}</pre></details>
      </div>
      <div class="side">
        <h4>대상의 주 시청 장르 (시청 이력 ${fmt(g.w)}명)</h4>
        ${g.top.length ? `<ol>${g.top.map(([n, c]) => `<li>${n}<span>${pct(c, g.w)}%</span></li>`).join("")}</ol>` : `<p>시청 이력 없음 — 전체 인기작으로 대체</p>`}
        <h4>추천 콘텐츠 · ${g.top.length ? g.top[0][0] : "전체"} 장르 유지 고객 인기작</h4>
        <ol>${titles.map(([n, c]) => `<li>${n}<span>${fmt(c)}명</span></li>`).join("")}</ol>
        <h4>유지 고객이 많이 고른 이용권</h4>
        <ol>${prodTop.map(([p, s]) => `<li>${p}<span>${s}%</span></li>`).join("")}</ol>
      </div>
    </div>`;
  }).join("");
}

// ── 메인 ─────────────────────────────────────
function render() {
  const ids = select();
  const m = compute(ids);
  renderHero(m);
  renderFunnel(m);
  renderKpis(m);
  renderDims();
  renderSeg(ids);
  renderBehav(ids);
  renderTrend(ids);
  renderTargets(m, ids);
  document.dispatchEvent(new Event('ott:render'));
}

function init() {
  $("dev").innerHTML = `<option value="all">전체</option>` + D.devices.map((d, i) => `<option value="${i}">${DEV_KO[d]}</option>`).join("");
  $("age").innerHTML = `<option value="all">전체</option>` + D.ages.map((a, i) => `<option value="${i}">${AGE_KO(a)}</option>`).join("");
  const from = $("from"), to = $("to");
  from.min = to.min = dayToStr(0); from.max = to.max = dayToStr(MAXDAY);
  const syncDates = () => { from.value = dayToStr(state.from); to.value = dayToStr(state.to); };
  const setPreset = (p) => document.querySelectorAll("#presets button").forEach((b) => b.classList.toggle("on", b.dataset.p === p));
  syncDates();

  const onDate = () => {
    let a = strToDay(from.value), b = strToDay(to.value);
    if (isNaN(a) || isNaN(b)) return;
    a = Math.max(0, Math.min(a, MAXDAY)); b = Math.max(0, Math.min(b, MAXDAY));
    if (a > b) [a, b] = [b, a];
    Object.assign(state, { from: a, to: b }); syncDates(); setPreset(""); render();
  };
  from.addEventListener("change", onDate); to.addEventListener("change", onDate);

  $("presets").addEventListener("click", (e) => {
    const p = e.target.dataset.p; if (!p) return;
    const feb = [0, strToDay("2025-02-28")], mar = [strToDay("2025-03-01"), strToDay("2025-03-31")];
    const r = { all: [0, MAXDAY], feb, mar, last14: [MAXDAY - 13, MAXDAY] }[p];
    Object.assign(state, { from: r[0], to: r[1] }); syncDates(); setPreset(p); render();
  });
  ["dev", "age", "gen", "push"].forEach((k) => $(k).addEventListener("change", (e) => { state[k] = e.target.value; render(); }));
  $("reset").addEventListener("click", () => {
    Object.assign(state, { from: 0, to: MAXDAY, dev: "all", age: "all", gen: "all", push: "all" });
    ["dev", "age", "gen", "push"].forEach((k) => ($(k).value = "all"));
    syncDates(); setPreset("all"); render();
  });
  $("dims").addEventListener("click", (e) => {
    const d = e.target.dataset.d; if (!d) return;
    state.dim = d; renderDims(); renderSeg(select());
  });
  $("targets").addEventListener("click", (e) => {
    const a = e.target.closest("[data-ai-target]"); if (a && window.OTT_AI) window.OTT_AI.open(a.dataset.aiTarget);
  });
  render();
}
init();
