"""CSV 7종 → 고객 1명당 1행 피처 테이블 → data.js (대시보드에서 필터별 재계산용)

실행: python build_data.py "<CSV 폴더 경로>"
"""
import json
import re
import sys
import os
from pathlib import Path

import pandas as pd

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get('DATA_CSV_DIR', str(Path(__file__).parent / 'source_csv')))
OUT = Path(__file__).parent / "data.js"

BEHAVIORS = [
    "HOME_VISIT", "CATEGORY_VISIT", "VOUCHER_VIEW", "SEARCH_OPEN", "SEARCH_SUBMIT",
    "SEARCH_CONTENT_CLICK", "SEARCH_MORE_CLICK", "DETAIL_PLAY_CLICK", "CONTENT_PURCHASE_CLICK",
    "DETAIL_ZZIM", "DETAIL_MORE", "RECOMMEND_CONTENT_CLICK", "DETAIL_LIST_CLICK",
    "CONTINUOUS_AUTOPLAY", "NEXT_EPISODE_CLICK",
]
DEVICES = ["mobile", "android", "ios", "pc"]
AGES = ["UNDER_14", "14_19", "20_29", "30_39", "40_49", "50_59", "60_69", "70_PLUS", "UNKNOWN"]
CH = {"V": 1, "M": 2, "L": 4}
FUNNEL_PAY_WINDOW = 30  # 첫 결제 D0~D30 → 이후 D+28까지 시청 데이터(D60) 안에서 관측 가능


def product_group(name: str) -> str:
    n = re.sub(r"\(.*?\)|OTT", "", str(name)).strip()
    if "장기이용권" in n:
        return "장기이용권 12개월"
    if n.startswith("더블"):
        return n if n in ("더블 광고형 스탠다드", "더블 스탠다드", "더블 프리미엄", "더블 베이직") else "더블 기타"
    if n in ("광고형 스탠다드", "베이직", "스탠다드", "프리미엄", "3 PACK"):
        return n
    if "번들" in n:
        return "디즈니+ 티빙 웨이브 번들"
    return "기타·제휴"


def main() -> None:
    missing = [n for n in ['user_dim','behavior_fact','payment_fact','watch_daily_fact',
                           'user_content_summary','content_dim','content_genre_bridge'] if not (SRC / f'{n}.csv').is_file()]
    if missing:
        raise FileNotFoundError(f'Missing CSV files in {SRC}: {missing}')
    u = pd.read_csv(SRC / "user_dim.csv")
    b = pd.read_csv(SRC / "behavior_fact.csv")
    p = pd.read_csv(SRC / "payment_fact.csv")
    w = pd.read_csv(SRC / "watch_daily_fact.csv")
    s = pd.read_csv(SRC / "user_content_summary.csv")
    c = pd.read_csv(SRC / "content_dim.csv", dtype=str)
    g = pd.read_csv(SRC / "content_genre_bridge.csv", dtype=str)

    u = u.drop_duplicates("user_key").reset_index(drop=True)
    idx = pd.Series(range(len(u)), index=u.user_key)
    base = pd.Timestamp(u.signup_date.min())

    # ── 첫 결제 (payment_order = 1) ─────────────────────
    fp = p[p.payment_order == 1].drop_duplicates("user_key").set_index("user_key")
    fp_day = fp.relative_signup_day.reindex(u.user_key).fillna(-1).astype(int).values
    products = sorted(fp.product_name.map(product_group).unique())
    prod = fp.product_name.map(product_group).map({k: i for i, k in enumerate(products)})
    prod = prod.reindex(u.user_key).fillna(-1).astype(int).values
    auto = fp.is_auto_payment.reindex(u.user_key).fillna(-1).astype(int).values
    repurchase = (p[p.payment_order > 1].groupby("user_key").size().reindex(u.user_key).fillna(0) > 0).astype(int).values

    # ── 탐색 행동 (D0~D30) : 전체 / 첫 결제 이전(결제일 포함) ──
    b = b[(b.relative_signup_day >= 0) & (b.relative_signup_day <= 30)].copy()
    b["bit"] = b.behavior_type.map({k: 1 << i for i, k in enumerate(BEHAVIORS)}).fillna(0).astype(int)
    b["fp"] = fp_day[idx[b.user_key].values]
    mask_all = b.groupby("user_key").bit.agg(lambda x: int(pd.Series(x).drop_duplicates().sum()))
    pre = b[(b.fp < 0) | (b.relative_signup_day <= b.fp)]
    mask_pre = pre.groupby("user_key").bit.agg(lambda x: int(pd.Series(x).drop_duplicates().sum()))
    bm = mask_all.reindex(u.user_key).fillna(0).astype(int).values
    bpre = mask_pre.reindex(u.user_key).fillna(0).astype(int).values

    # ── 시청 : 결제 후 활성화/유지, 채널 이용 ─────────────
    w["fp"] = fp_day[idx[w.user_key].values]
    w["d"] = w.relative_signup_day - w.fp
    paid_w = w[w.fp >= 0]

    def flag(cond: pd.Series) -> list:
        users = set(paid_w.loc[cond, "user_key"])
        return [1 if k in users else 0 for k in u.user_key]

    a7 = flag((paid_w.d >= 0) & (paid_w.d <= 7))
    a14 = flag((paid_w.d >= 0) & (paid_w.d <= 14))
    a28 = flag((paid_w.d >= 0) & (paid_w.d <= 28))
    ret = flag((paid_w.d >= 22) & (paid_w.d <= 28))
    ch = w.groupby("user_key").channel_type.agg(lambda x: sum(CH[t] for t in set(x)))
    ch = ch.reindex(u.user_key).fillna(0).astype(int).values
    wpre_users = set(w.loc[(w.fp < 0) | (w.relative_signup_day < w.fp), "user_key"])
    wpre = [1 if k in wpre_users else 0 for k in u.user_key]

    # ── 장르 : 고객별 시청시간 1위 장르 (다중 장르는 각각 귀속) ──
    g = g[g.genre_source != "LIVE_CHANNEL_GENRE"].drop_duplicates(["content_key", "genre_name"])
    sg = s.merge(g[["content_key", "genre_name"]], on="content_key", how="left")
    sg.loc[sg.channel_type == "L", "genre_name"] = "LIVE"
    sg = sg.dropna(subset=["genre_name"])
    ug = sg.groupby(["user_key", "genre_name"]).total_watch_time_raw.sum().reset_index()
    # Deterministic tie-breaking: two genres may have identical raw watch totals.
    top = ug.sort_values(["user_key", "total_watch_time_raw", "genre_name"],
                         ascending=[True, False, True], kind="mergesort").drop_duplicates("user_key")
    common = top.genre_name.value_counts().rename_axis("genre_name").reset_index(name="users")
    common = common.sort_values(["users", "genre_name"], ascending=[False, True], kind="mergesort")
    genres = [x for x in common.genre_name.tolist()[:16] if x != "기타"] + ["기타"]
    top["gi"] = top.genre_name.map({k: i for i, k in enumerate(genres)}).fillna(len(genres) - 1).astype(int)
    tg = top.set_index("user_key").gi.reindex(u.user_key).fillna(-1).astype(int).values

    # ── 추천 콘텐츠 후보 : 지속 시청 고객(ret=1)이 많이 본 타이틀 (장르별) ──
    ret_users = set(u.user_key[[r == 1 for r in ret]])
    titles = c.set_index("content_key").title
    sr = sg[sg.user_key.isin(ret_users)]
    reco = {}
    for gname in genres:
        top_c = sr[sr.genre_name == gname].groupby("content_key").user_key.nunique().nlargest(5)
        reco[gname] = [[str(titles.get(k, k)), int(v)] for k, v in top_c.items() if pd.notna(titles.get(k))]
    overall = sr.groupby("content_key").user_key.nunique().nlargest(10)
    reco["_all"] = [[str(titles.get(k, k)), int(v)] for k, v in overall.items()]

    sd = (pd.to_datetime(u.signup_date) - base).dt.days.values
    data = {
        "base": base.strftime("%Y-%m-%d"),
        "behaviors": BEHAVIORS,
        "devices": DEVICES,
        "ages": AGES,
        "products": products,
        "genres": genres,
        "reco": reco,
        "payWindow": FUNNEL_PAY_WINDOW,
        "keys": u.user_key.tolist(),  # 타깃 CSV 추출용
        "cols": {
            "sd": sd.tolist(),
            "dev": u.signup_device_type.map({k: i for i, k in enumerate(DEVICES)}).tolist(),
            "gen": u.gender_code.astype(int).tolist(),
            "age": u.age_band.map({k: i for i, k in enumerate(AGES)}).fillna(len(AGES) - 1).astype(int).tolist(),
            "push": u.push_opt_in_current.astype(int).tolist(),
            "bm": bm.tolist(),
            "bpre": bpre.tolist(),
            "fp": fp_day.tolist(),
            "prod": prod.tolist(),
            "auto": auto.tolist(),
            "rep": repurchase.tolist(),
            "a7": a7, "a14": a14, "a28": a28, "ret": ret,
            "ch": ch.tolist(),
            "wpre": wpre,
            "tg": tg.tolist(),
        },
    }
    tmp = OUT.with_name(OUT.name + ".tmp")
    tmp.write_text("window.DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";", encoding="utf-8")
    tmp.replace(OUT)  # Atomic: the API must never import a half-written snapshot
    print(f"users={len(u)} payers={int((fp_day >= 0).sum())} -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
