"""Deterministic pairwise associations between customer features.

Every number shown in the relation graph comes from here (2x2 contingency tables on the
SQLite snapshot). GPT only selects and narrates edges; verify_findings() rejects any
sentence whose numbers are not roundings of these values or that uses causal/hypothesis wording.
"""
import json
import math
import re
from datetime import date, timedelta
from itertools import combinations
import numpy as np
from .analysis import context

# group: attr(가입 속성) · beh(D0~D30 탐색 행동) · watch(D0~D60 시청 유형) · outcome(결제·시청 결과)
# population 'payers' = D0~D30 첫 결제 고객만 분모. exclusive = 같은 값이면 상호배타(정의상 음의 연관)
def _nodes(md):
    beh = md.get('behaviors', [])
    bit = lambda *names: sum(1 << beh.index(n) for n in names if n in beh)
    dev = md.get('devices', [])
    ages = md.get('ages', [])
    age_idx = lambda *names: [ages.index(n) for n in names if n in ages]
    nodes = [
        ('push', '푸시 알림 동의', 'attr', 'all', None, lambda r: r['push'] == 1),
        *[(f'dev_{d}', f'{d} 가입', 'attr', 'all', 'device', (lambda k: lambda r: r['device'] == k)(i)) for i, d in enumerate(dev)],
        ('age_20', '20대', 'attr', 'all', 'age', lambda r, s=age_idx('20_29'): np.isin(r['age'], s)),
        ('age_30', '30대', 'attr', 'all', 'age', lambda r, s=age_idx('30_39'): np.isin(r['age'], s)),
        ('age_40', '40대', 'attr', 'all', 'age', lambda r, s=age_idx('40_49'): np.isin(r['age'], s)),
        ('age_50p', '50대+', 'attr', 'all', 'age', lambda r, s=age_idx('50_59', '60_69', '70_PLUS'): np.isin(r['age'], s)),
        ('voucher', '이용권 페이지 봄', 'beh', 'all', None, lambda r, b=bit('VOUCHER_VIEW'): (r['bm'] & b) != 0),
        ('search', '검색함', 'beh', 'all', None, lambda r, b=bit('SEARCH_OPEN', 'SEARCH_SUBMIT', 'SEARCH_CONTENT_CLICK', 'SEARCH_MORE_CLICK'): (r['bm'] & b) != 0),
        ('detail_play', '작품 상세에서 재생', 'beh', 'all', None, lambda r, b=bit('DETAIL_PLAY_CLICK'): (r['bm'] & b) != 0),
        ('zzim', '찜함', 'beh', 'all', None, lambda r, b=bit('DETAIL_ZZIM'): (r['bm'] & b) != 0),
        ('recommend', '추천 작품 클릭', 'beh', 'all', None, lambda r, b=bit('RECOMMEND_CONTENT_CLICK'): (r['bm'] & b) != 0),
        ('binge', '이어보기 · 다음 화', 'beh', 'all', None, lambda r, b=bit('CONTINUOUS_AUTOPLAY', 'NEXT_EPISODE_CLICK'): (r['bm'] & b) != 0),
        ('purchase_click', '개별 구매 클릭', 'beh', 'all', None, lambda r, b=bit('CONTENT_PURCHASE_CLICK'): (r['bm'] & b) != 0),
        ('vod', '시리즈(VOD) 시청', 'watch', 'all', None, lambda r: (r['ch'] & 1) != 0),
        ('movie', '영화 시청', 'watch', 'all', None, lambda r: (r['ch'] & 2) != 0),
        ('live', '실시간 TV 시청', 'watch', 'all', None, lambda r: (r['ch'] & 4) != 0),
        ('paid30', '30일 안에 첫 결제', 'outcome', 'all', None, lambda r: (r['fp'] >= 0) & (r['fp'] <= 30)),
        ('act7', '결제 후 7일 안에 시청', 'outcome', 'payers', None, lambda r: r['a7'] == 1),
        ('retained', '결제 4주차에도 시청', 'outcome', 'payers', None, lambda r: r['ret'] == 1),
        ('auto', '정기결제', 'outcome', 'payers', None, lambda r: r['auto'] == 1),
    ]
    return [dict(id=i, label=l, group=g, population=p, exclusive=x, test=t) for i, l, g, p, x, t in nodes]

WATCH_BASED = {'vod', 'movie', 'live', 'act7', 'retained', 'binge'}
VIEWS = ('network', 'radial', 'matrix', 'rank')
VIZ = ('bar', 'donut', 'gauge', 'dots', 'mosaic')

def _strength(phi):
    a = abs(phi)
    return '강함' if a >= .5 else '보통' if a >= .3 else '약함' if a >= .1 else '거의 없음'

def _caveats(x, y, pop_n):
    ids, groups = {x['id'], y['id']}, {x['group'], y['group']}
    out = []
    if x['population'] == 'payers' or y['population'] == 'payers':
        out.append(f'결제한 고객 {pop_n:,}명만 놓고 계산했어요')
    if 'beh' in groups and ids & {'paid30', 'auto'}:
        out.append('행동은 가입 후 30일 전체 기준이라, 결제 전에 했는지 후에 했는지는 구분하지 않아요')
    if 'watch' in groups and 'outcome' in groups:
        out.append('시청은 가입 후 60일 전체 기준이라, 결제 전인지 후인지는 구분하지 않아요')
    if len(ids & WATCH_BASED) == 2:
        out.append('둘 다 시청 기록에서 나온 지표라 원래 겹치기 쉬워요')
    if 'push' in ids:
        out.append('푸시 동의 여부는 가입 당시가 아니라 데이터를 뽑은 시점 기준이에요')
    return out

def compute(c, filters=None):
    meta, p, where = context(c, filters)
    md = json.loads(meta['dictionaries_json'])
    rows = c.execute(f'SELECT device,age,push,behavior_mask bm,first_payment_day fp,activated7 a7,retained ret,'
                     f'channel_mask ch,auto_payment auto FROM customers WHERE {where}', p).fetchall()
    cols = {k: np.array([r[k] for r in rows], dtype=np.int64) for k in ('device','age','push','bm','fp','a7','ret','ch','auto')} if rows else {}
    n_all = len(rows)
    payers = ((cols['fp'] >= 0) & (cols['fp'] <= 30)) if rows else np.zeros(0, bool)
    defs = _nodes(md)
    X = {d['id']: (np.asarray(d['test'](cols), bool) if rows else np.zeros(0, bool)) for d in defs}
    nodes = []
    for d in defs:
        pop = payers if d['population'] == 'payers' else np.ones(n_all, bool)
        pn, k = int(pop.sum()), int((X[d['id']] & pop).sum())
        nodes.append({'id': d['id'], 'label': d['label'], 'group': d['group'], 'population': d['population'],
                      'count': k, 'population_n': pn, 'share': k / pn if pn else None,
                      'constant': pn == 0 or k in (0, pn)})
    edges, skipped = [], 0
    for x, y in combinations(defs, 2):
        if x['exclusive'] and x['exclusive'] == y['exclusive']: skipped += 1; continue  # 상호배타: 정의상 연관
        payer_pop = x['population'] == 'payers' or y['population'] == 'payers'
        if payer_pop and 'paid30' in (x['id'], y['id']): skipped += 1; continue  # 결제자 안에서 상수
        pop = payers if payer_pop else np.ones(n_all, bool)
        A, B = X[x['id']] & pop, X[y['id']] & pop
        n = int(pop.sum()); a = int((A & B).sum()); na, nb = int(A.sum()), int(B.sum())
        b, cc = na - a, nb - a; dd = n - a - b - cc
        if n == 0 or 0 in (na, nb, n - na, n - nb): continue  # 주변합 0 → 연관 정의 불가
        phi = (a * dd - b * cc) / math.sqrt(na * (n - na) * nb * (n - nb))
        chi2 = n * phi * phi
        min_exp = min(na * nb, na * (n - nb), (n - na) * nb, (n - na) * (n - nb)) / n
        edges.append({
            'id': f"{x['id']}__{y['id']}", 'source': x['id'], 'target': y['id'],
            'population': 'payers' if payer_pop else 'all', 'n': n,
            'table': {'both': a, 'a_only': b, 'b_only': cc, 'neither': dd},
            'p_a': na / n, 'p_b': nb / n,
            'p_b_given_a': a / na, 'p_b_given_not_a': cc / (n - na),
            'p_a_given_b': a / nb, 'p_a_given_not_b': b / (n - nb),
            'lift': (a / na) / (nb / n), 'phi': phi, 'chi2': chi2,
            'p_value': math.erfc(math.sqrt(chi2 / 2)), 'min_expected': min_exp,
            'strength': _strength(phi), 'caveats': _caveats(x, y, n)})
    m = len(edges)
    alpha = 0.05 / m if m else 0.05
    for e in edges:
        e['diff_pp'] = (e['p_b_given_a'] - e['p_b_given_not_a']) * 100
        e['diff_pp_rev'] = (e['p_a_given_b'] - e['p_a_given_not_b']) * 100
        e['reliable'] = e['min_expected'] >= 5
        e['significant'] = e['reliable'] and e['p_value'] < alpha
    edges.sort(key=lambda e: -abs(e['phi']))
    max_day = c.execute('SELECT MAX(signup_day) FROM customers WHERE snapshot_id=?', (meta['id'],)).fetchone()[0] or 0
    dims = {'devices': md.get('devices', []), 'ages': md.get('ages', []), 'base_date': meta['base_date'],
            'max_date': (date.fromisoformat(meta['base_date']) + timedelta(days=max_day)).isoformat()}
    return {'snapshot_id': meta['id'], 'dims': dims, 'n': n_all, 'payers': int(payers.sum()), 'nodes': nodes, 'edges': edges,
            'tests': m, 'alpha_bonferroni': alpha, 'skipped_definitional': skipped,
            'method': '연관 강도는 φ(파이) 계수, 우연 여부는 χ² 검정 + 본페로니 보정(α=0.05/비교 수)으로 계산'}

# ── GPT narration + verification ───────────────────────────────────────────
SYSTEM_FACT = """당신은 시니어 그로스 마케터이자 데이터 분석가입니다.
입력은 서버가 SQL 스냅샷에서 계산한 지표 간 연관(2×2 교차표, φ계수, Lift, 조건부 비율)입니다.
규칙:
1) 가설·추정·인과 해석을 절대 쓰지 마세요. '때문에', '원인', '영향', '가능성', '~로 보인다', '시사' 같은 표현 금지.
2) 함께 나타나는 정도(연관)만 사실로 서술하세요. 'A 고객의 B 비율은 x%로, A가 아닌 고객(y%)보다 z%p 높다' 형식.
3) 숫자는 입력에 있는 값을 그대로 또는 반올림해서만 쓰세요. 새로 계산한 숫자(합, 차이의 비율 등)를 만들지 마세요.
4) 정의상 겹치는 지표나 caveat가 있는 연관은 caveat을 사실로 언급하세요.
5) 마케터가 바로 이해할 쉬운 말로 쓰세요. 'φ', 'lift', '유의', '교차표' 같은 통계 용어는 쓰지 말고 'x배', 'x%p 높다', '함께 나타난다'로 표현하세요.
6) 한국어, 짧은 문장. 반드시 JSON만 출력."""

def _fmt_pct(v): return round(v * 100, 1)

def _edge_payload(e, labels):
    return {'edge_id': e['id'], 'A': labels[e['source']], 'B': labels[e['target']],
            '모집단': '첫 결제 고객' if e['population'] == 'payers' else '선택 가입 고객', 'n': e['n'],
            'A∧B 고객수': e['table']['both'],
            'A 비율%': _fmt_pct(e['p_a']), 'B 비율%': _fmt_pct(e['p_b']),
            'A 중 B%': _fmt_pct(e['p_b_given_a']), '비A 중 B%': _fmt_pct(e['p_b_given_not_a']),
            'B 중 A%': _fmt_pct(e['p_a_given_b']), '비B 중 A%': _fmt_pct(e['p_a_given_not_b']),
            '차이%p(B|A−B|비A)': round(e['diff_pp'], 1), '차이%p(A|B−A|비B)': round(e['diff_pp_rev'], 1),
            'lift': round(e['lift'], 2), 'phi': round(e['phi'], 3), '강도': e['strength'], 'caveats': e['caveats']}

def analysis_prompt(facts, max_edges=36):
    labels = {nd['id']: nd['label'] for nd in facts['nodes']}
    pool = [e for e in facts['edges'] if e['significant'] and abs(e['phi']) >= 0.05][:max_edges]
    payload = {
        '모집단': {'선택 가입 고객': facts['n'], '첫 결제 고객': facts['payers']},
        '지표': [{'id': nd['id'], 'label': nd['label'], '그룹': nd['group'], '비율%': None if nd['share'] is None else _fmt_pct(nd['share']),
                 '고객수': nd['count']} for nd in facts['nodes'] if not nd['constant']],
        '연관': [_edge_payload(e, labels) for e in pool],
    }
    schema = {
        'headline': '전체 연관 구조를 요약한 사실 문장 1개',
        'recommended_view': '|'.join(VIEWS) + ' 중 하나 (연관이 소수 허브에 몰리면 network, 그룹 간 흐름이면 radial, 전반 밀도 비교면 matrix, 순위가 핵심이면 rank)',
        'view_reason': '그 뷰를 고른 데이터상 이유 1문장',
        'focus_nodes': ['가장 많은 강한 연관을 가진 지표 id 1~4개'],
        'findings': [{'edge_ids': ['근거 edge_id 1~3개'], 'title': '12자 내외의 쉬운 제목 (예: 이어보기 고객은 결제도 많다)', 'fact': '사실 서술 1~2문장',
                      'use': '이 사실을 마케터가 타깃 정의·리포트에 활용하는 방법 1문장 (효과 예측 금지)',
                      'viz': '|'.join(VIZ) + ' 중 하나 (조건부 비율 비교=bar, 구성비=donut, 연관 강도=gauge, 규모감=dots, 교차표=mosaic)'}],
    }
    return (f'다음 연관 데이터에서 마케팅에 중요한 사실 4~6개를 고르세요. 마케팅 결과 지표(D+30 첫 결제, D+7 시청, 유지, 자동결제)와 연결된 연관을 우선하세요.\n'
            f'viz는 각 사실의 핵심을 가장 잘 보여주는 형태로 고르되, 같은 viz는 최대 2번까지만 쓰세요.\n'
            f'출력 JSON 스키마: {json.dumps(schema, ensure_ascii=False)}\n'
            f'데이터: {json.dumps(payload, ensure_ascii=False)}'), pool

BANNED = ('때문', '원인', '유발', '야기', '기인', '덕분', '가능성', '추정', '추측', '아마', '것으로 보', '것 같', '듯',
          '예상', '시사', '가설', '영향', '효과가 있', '증가시', '감소시', '이끌', '견인', '기여')
NUM = re.compile(r'(\d+(?:,\d{3})*(?:\.\d+)?)\s*(%p|%|배|명|건)?')

def _label_numbers(text):
    return {float(x) for x in re.findall(r'\d+', text)}

def _allowed(edges, nodes):
    vals = set()
    for e in edges:
        t = e['table']
        vals |= {e['n'], *t.values(), t['both'] + t['a_only'], t['both'] + t['b_only'], abs(e['diff_pp']), abs(e['diff_pp_rev']),
                 e['lift'], abs(e['phi'])}
        vals |= {v * 100 for v in (e['p_a'], e['p_b'], e['p_b_given_a'], e['p_b_given_not_a'], e['p_a_given_b'], e['p_a_given_not_b'])}
        vals |= {float(x.replace(',', '')) for cv in e['caveats'] for x in re.findall(r'\d+(?:,\d{3})*', cv)}
    for nd in nodes:
        vals |= _label_numbers(nd['label'])
        vals.add(nd['count'])
        if nd['share'] is not None: vals.add(nd['share'] * 100)
    return vals

def _numbers_ok(text, allowed):
    """Each number must be a rounding of an allowed source value at its own precision."""
    for m in NUM.finditer(text):
        raw, unit = m.group(1), m.group(2)
        x = float(raw.replace(',', ''))
        dp = len(raw.split('.')[1]) if '.' in raw else 0
        if dp == 0 and x <= 6 and not unit: continue  # '3개 그룹', '1위' 같은 서수·개수
        tol = 0.5 * 10 ** -dp + 1e-9
        if not any(abs(x - v) <= tol for v in allowed):
            return raw + (unit or '')
    return None

def verify(raw, facts, pool):
    by_id = {e['id']: e for e in pool}
    node_ids = {nd['id'] for nd in facts['nodes']}
    all_allowed = _allowed(pool, facts['nodes']) | {facts['n'], facts['payers']}
    findings, rejected = [], []
    for f in (raw.get('findings') or [])[:8]:
        if not isinstance(f, dict): continue
        ids = [i for i in (f.get('edge_ids') or []) if i in by_id][:3]
        title, fact, use = (str(f.get(k, '')).strip()[:400] for k in ('title', 'fact', 'use'))
        reason = None
        if not ids: reason = '근거 edge_id가 서버 계산 결과에 없음'
        elif not fact: reason = '사실 문장이 비어 있음'
        else:
            text = ' '.join((title, fact, use))
            bad = next((w for w in BANNED if w in text), None)
            if bad: reason = f"추정·인과 표현 '{bad}' 포함"
            else:
                wrong = _numbers_ok(text, _allowed([by_id[i] for i in ids], facts['nodes']) | {facts['n'], facts['payers']})
                if wrong: reason = f"원본에 없는 수치 '{wrong}'"
        if reason:
            rejected.append({'title': title or '(제목 없음)', 'fact': fact, 'reason': reason})
            continue
        viz = f.get('viz') if f.get('viz') in VIZ else 'bar'
        findings.append({'edge_ids': ids, 'title': title, 'fact': fact, 'use': use, 'viz': viz})
    headline = str(raw.get('headline', '')).strip()[:300]
    if headline and (any(w in headline for w in BANNED) or _numbers_ok(headline, all_allowed)):
        rejected.append({'title': '헤드라인', 'fact': headline, 'reason': '검증 실패 — 추정 표현 또는 원본에 없는 수치'})
        headline = ''
    view = raw.get('recommended_view') if raw.get('recommended_view') in VIEWS else 'network'
    view_reason = str(raw.get('view_reason', '')).strip()[:200]
    if any(w in view_reason for w in BANNED) or _numbers_ok(view_reason, all_allowed): view_reason = ''
    focus = [i for i in (raw.get('focus_nodes') or []) if i in node_ids][:4]
    return {'headline': headline or (findings[0]['title'] if findings else ''), 'recommended_view': view,
            'view_reason': view_reason, 'focus_nodes': focus, 'findings': findings, 'rejected': rejected}
