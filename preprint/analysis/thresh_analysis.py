#!/usr/bin/env python3
"""
thresh_analysis.py — Reproducible analysis for the preprint
"Carrying the Harvest by Hand: The Threshing Floor, a Provenance-First,
Human-in-the-Loop Instrument for Studying Public Reddit Discourse."

What this script does
---------------------
Reads every Thresh export found under  preprint/data/collections/<name>/
(each a folder holding posts.csv, comments.csv, provenance.txt exactly as
Thresh's Glean page writes them), and produces:

  results/stats.json            every number quoted in the manuscript
  results/tables/*.csv          every table (and supplementary table)
  results/figures/fig*.png|pdf  every data figure (Figure 1 is drawn by
                                figure_workflow.py)

The analysis is organized around the "watch list" of the project memo that
motivated the paper, restricted to what a Thresh export can actually measure:

  A. Collection audit          — provenance claims checked against the bytes
  B. Governance footprint      — moderation as data (AutoModerator, removals, flair)
  C. Temporal structure        — post/comment volume by day; diurnal rhythm
  D. Source ecology            — which outlets carry the story
  E. Participation structure   — concentration & cross-thread participation
  F. Framing                   — transparent dictionary frames (frame_lexicon.json)
  G. Sentiment                 — VADER, daily series with bootstrap intervals
  H. Language & duplication    — cross-script content; verbatim duplicate texts
  I. Cross-collection overlap  — pseudonym overlap, when >1 collection is present

Design commitments
------------------
* Deterministic: fixed random seed; no network; inputs are checksummed.
* No verbatim user comments are written to any output (only aggregate counts,
  news headlines, and bot text) — see the manuscript's ethics statement.
* Adding a collection = dropping a Thresh export folder into data/collections/.

Usage
-----
    pip install -r preprint/requirements.txt
    python preprint/analysis/thresh_analysis.py
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats as sps
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

# --------------------------------------------------------------------------- #
# Paths & constants
# --------------------------------------------------------------------------- #
HERE = Path(__file__).resolve().parent
PREPRINT = HERE.parent
DATA = PREPRINT / "data"
COLLECTIONS = DATA / "collections"
PROTOCOL = DATA / "protocol"
RESULTS = PREPRINT / "results"
FIGS = RESULTS / "figures"
TABLES = RESULTS / "tables"

PRIMARY = "r-politics_iran_2026-03-20"      # the worked exemplar
SEED = 20260320                              # collection date; fixes bootstrap
N_BOOT = 2000
MIN_DAILY_N = 30                             # days with fewer comments are not plotted
EASTERN = ZoneInfo("America/New_York")
BOT_MARKER = "I am a bot, and this action was performed automatically"

# Typeface: IBM Plex Sans (bundled, SIL OFL) so figures match the manuscript; DejaVu Sans fallback.
from matplotlib import font_manager as _fm
for _ttf in (Path(__file__).resolve().parent.parent / "manuscript" / "fonts").glob("IBMPlexSans-*.ttf"):
    _fm.fontManager.addfont(str(_ttf))
FONT_FAMILY = ["IBM Plex Sans", "DejaVu Sans"]

# Print palette (validated for CVD separation; see README "Figures")
INK = "#23232B"
MUTED = "#6B6B7B"
GRID = "#E4E1DA"
EMBER = "#B08A1E"      # primary series
RUST = "#B5452F"
BLUE = "#2F6DB0"
GREEN = "#3E8E5A"

plt.rcParams.update({
    "font.family": FONT_FAMILY,
    "font.size": 9,
    "axes.titlesize": 10,
    "axes.titleweight": "bold",
    "axes.titlelocation": "left",
    "axes.labelsize": 9,
    "axes.labelcolor": INK,
    "axes.edgecolor": MUTED,
    "axes.linewidth": 0.6,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "xtick.labelsize": 8,
    "ytick.labelsize": 8,
    "grid.color": GRID,
    "grid.linewidth": 0.6,
    "legend.frameon": False,
    "legend.fontsize": 8,
    "figure.dpi": 150,
    "savefig.dpi": 300,
    "savefig.bbox": "tight",
    "savefig.pad_inches": 0.04,
})

STOPWORDS = set("""
a about above after again against all also am an and any are aren't as at be because been before being below
between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few
for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him
himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself just let's like me more most
mustn't my myself no nor not now of off on once only or other ought our ours ourselves out over own same shan't
she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there
there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd
we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's will
with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves get got going go one even
really much many would still say said says see make made know think people thing things way well back us u
dont im thats doesnt didnt cant wont isnt youre theyre ive also yes yeah lol gonna want need right good
new time now just every never going been being two first last since may might must
""".split())

SPANISH_MARKERS = set("el la los las que de del y en por para con una uno es son está están pero porque muy también".split())


def log(msg: str) -> None:
    print(f"[thresh] {msg}", flush=True)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def r(x, nd=3):
    """Round for JSON, converting numpy scalars."""
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating, float)):
        return round(float(x), nd)
    return x


def save(fig, name: str) -> None:
    for ext in ("png", "pdf"):
        fig.savefig(FIGS / f"{name}.{ext}", facecolor="white")
    plt.close(fig)
    log(f"figure → results/figures/{name}.png")


# --------------------------------------------------------------------------- #
# Loading
# --------------------------------------------------------------------------- #
def parse_provenance(text: str) -> dict:
    """Pull 'Key: value' pairs from a Thresh provenance.txt."""
    out = {}
    for line in text.splitlines():
        m = re.match(r"^\s{2}([A-Za-z()\s/-]+?):\s+(.*)$", line)
        if m:
            out[m.group(1).strip()] = m.group(2).strip()
    return out


def load_collection(folder: Path) -> dict:
    posts = pd.read_csv(folder / "posts.csv", encoding="utf-8-sig", keep_default_na=False,
                        dtype={"id": str, "author": str, "flair": str})
    comments = pd.read_csv(folder / "comments.csv", encoding="utf-8-sig", keep_default_na=False,
                           dtype={"id": str, "post_id": str, "author": str, "parent_id": str, "body": str})
    for col in ("score", "num_comments", "created_utc"):
        posts[col] = pd.to_numeric(posts[col], errors="coerce")
    posts["upvote_ratio"] = pd.to_numeric(posts["upvote_ratio"], errors="coerce")
    for col in ("score", "created_utc", "depth"):
        comments[col] = pd.to_numeric(comments[col], errors="coerce")
    posts["ts"] = pd.to_datetime(posts["created_utc"], unit="s", utc=True)
    comments["ts"] = pd.to_datetime(comments["created_utc"], unit="s", utc=True)
    prov_text = (folder / "provenance.txt").read_text(encoding="utf-8")
    return {
        "name": folder.name,
        "posts": posts,
        "comments": comments,
        "provenance": parse_provenance(prov_text),
        "checksums": {f: sha256(folder / f) for f in ("posts.csv", "comments.csv", "provenance.txt")},
    }


def anonymize_js(username: str) -> str:
    """Python port of Exporter._anonymize (public/js/exporter.js) — used only to
    identify known bot accounts; demonstrates the pseudonyms are reversible."""
    if not username or username == "[deleted]":
        return "[deleted]"
    h = 0
    for ch in username:
        h = ((h << 5) - h + ord(ch)) & 0xFFFFFFFF
    if h >= 2**31:
        h -= 2**32
    n, digits, s = abs(h), "0123456789abcdefghijklmnopqrstuvwxyz", ""
    while True:
        n, rem = divmod(n, 36)
        s = digits[rem] + s
        if n == 0:
            break
    return "user_" + s[:8]


# --------------------------------------------------------------------------- #
# Analyses
# --------------------------------------------------------------------------- #
def classify_comments(c: pd.DataFrame) -> pd.DataFrame:
    """Tag each comment's status: bot / deleted / removed / human."""
    c = c.copy()
    automod = anonymize_js("AutoModerator")
    body = c["body"].fillna("")
    c["is_bot"] = body.str.contains(BOT_MARKER, regex=False) | (c["author"] == automod)
    c["is_removed_body"] = body.str.strip().isin(["[removed]"])
    c["is_deleted_body"] = body.str.strip().isin(["[deleted]"])
    c["is_deleted_author"] = c["author"] == "[deleted]"
    c["is_analyzable"] = ~(c["is_bot"] | c["is_removed_body"] | c["is_deleted_body"]) & (body.str.strip().str.len() > 0)
    return c


def collection_audit(col: dict) -> dict:
    p, c, prov = col["posts"], col["comments"], col["provenance"]
    collected_at = pd.Timestamp(prov.get("Collection timestamp (UTC)", p["ts"].max().isoformat()))
    if collected_at.tzinfo is None:
        collected_at = collected_at.tz_localize("UTC")
    kw = prov.get("Keyword filter", "")
    per_post = c.groupby("post_id").size()
    cov = (per_post / p.set_index("id")["num_comments"]).dropna()
    orphan = (~c["post_id"].isin(p["id"])).sum()
    return {
        "tool_version": prov.get("Version"),
        "method": prov.get("Method"),
        "subreddits": prov.get("Subreddit(s)"),
        "sort": prov.get("Sort"),
        "time_filter": prov.get("Time filter"),
        "keyword": kw,
        "max_posts_requested": r(pd.to_numeric(prov.get("Max posts requested"), errors="coerce"), 0),
        "posts_claimed": r(pd.to_numeric(prov.get("Posts collected"), errors="coerce"), 0),
        "comments_claimed": r(pd.to_numeric(prov.get("Comments collected"), errors="coerce"), 0),
        "posts_observed": int(len(p)),
        "comments_observed": int(len(c)),
        "posts_match": int(len(p)) == int(pd.to_numeric(prov.get("Posts collected"), errors="coerce")),
        "comments_match": int(len(c)) == int(pd.to_numeric(prov.get("Comments collected"), errors="coerce")),
        "duplicate_post_ids": int(p["id"].duplicated().sum()),
        "duplicate_comment_ids": int(c["id"].duplicated().sum()),
        "orphan_comments": int(orphan),
        "collection_timestamp_utc": collected_at.isoformat(),
        "post_window_start_utc": p["ts"].min().isoformat(),
        "post_window_end_utc": p["ts"].max().isoformat(),
        "post_window_days": r((p["ts"].max() - p["ts"].min()).total_seconds() / 86400, 1),
        "oldest_post_age_days_at_collection": r((collected_at - p["ts"].min()).total_seconds() / 86400, 1),
        "keyword_in_title_share": r(p["title"].str.contains(kw, case=False, regex=False).mean(), 3) if kw else None,
        "self_post_share": r((p["is_self"].astype(str).str.lower() == "true").mean(), 3),
        "comment_depths": {str(k): int(v) for k, v in c["depth"].value_counts().sort_index().items()},
        "comments_per_post": {"min": int(per_post.min()), "median": r(per_post.median(), 1), "max": int(per_post.max())},
        "reported_comments_total": int(p["num_comments"].sum()),
        "coverage_overall": r(len(c) / p["num_comments"].sum(), 4),
        "coverage_per_post_median": r(cov.median(), 4),
        "coverage_per_post_iqr": [r(cov.quantile(.25), 4), r(cov.quantile(.75), 4)],
        "hours_to_collection_median": r(((collected_at - p["ts"]).dt.total_seconds() / 3600).median(), 1),
    }


def governance_footprint(p: pd.DataFrame, c: pd.DataFrame) -> dict:
    n = len(c)
    flair = p["flair"].replace("", "(none)").value_counts()
    flair_parts = Counter()
    for f in p["flair"]:
        for part in [x.strip() for x in f.split("|") if x.strip()]:
            flair_parts[part] += 1
    bot_posts_covered = c.loc[c["is_bot"], "post_id"].nunique()
    return {
        "automoderator_pseudonym": anonymize_js("AutoModerator"),
        "bot_comments": int(c["is_bot"].sum()),
        "bot_comment_share": r(c["is_bot"].mean(), 4),
        "threads_with_bot_notice": int(bot_posts_covered),
        "threads_with_bot_notice_share": r(bot_posts_covered / p["id"].nunique(), 3),
        # share of threads whose first exported comment (Reddit's own order) is the bot notice
        "bot_notice_first_in_thread_share": r(c.groupby("post_id", sort=False).head(1)["is_bot"].mean(), 3),
        "removed_bodies": int(c["is_removed_body"].sum()),
        "deleted_bodies": int(c["is_deleted_body"].sum()),
        "deleted_authors": int(c["is_deleted_author"].sum()),
        "removed_or_deleted_share": r((c["is_removed_body"] | c["is_deleted_body"]).mean(), 4),
        "deleted_author_share": r(c["is_deleted_author"].mean(), 4),
        "analyzable_comments": int(c["is_analyzable"].sum()),
        "flair_full": {k: int(v) for k, v in flair.items()},
        "flair_components": {k: int(v) for k, v in flair_parts.most_common()},
        "site_altered_headline_posts": int(p["flair"].str.contains("Site Altered Headline").sum()),
        "n_comments": n,
    }


def temporal(p: pd.DataFrame, c: pd.DataFrame) -> tuple[dict, pd.DataFrame, pd.DataFrame]:
    days = pd.date_range(p["ts"].min().normalize(), c["ts"].max().normalize(), freq="D", tz="UTC")
    posts_day = p.groupby(p["ts"].dt.normalize()).size().reindex(days, fill_value=0)
    comm_day = c.groupby(c["ts"].dt.normalize()).size().reindex(days, fill_value=0)
    daily = pd.DataFrame({"date": days.date, "posts": posts_day.values, "comments": comm_day.values})

    human = c[c["is_analyzable"]]
    et = human["ts"].dt.tz_convert(EASTERN)
    hour_et = et.dt.hour.value_counts().reindex(range(24), fill_value=0)
    hour_utc = human["ts"].dt.hour.value_counts().reindex(range(24), fill_value=0)
    hourly = pd.DataFrame({"hour": range(24), "comments_et": hour_et.values, "comments_utc": hour_utc.values})

    # Rayleigh test for non-uniform circular (24-h) distribution
    theta = 2 * np.pi * et.dt.hour.add(et.dt.minute / 60).to_numpy() / 24
    C, S = np.cos(theta).mean(), np.sin(theta).mean()
    Rbar = math.hypot(C, S)
    n = len(theta)
    z = n * Rbar**2
    p_ray = math.exp(math.sqrt(1 + 4 * n + 4 * (n**2 - (n * Rbar) ** 2)) - (1 + 2 * n))
    mean_hour = (math.degrees(math.atan2(S, C)) % 360) / 15
    overnight = hour_et.loc[1:6].sum() / hour_et.sum()      # 01:00–06:59 ET
    peak_day = daily.loc[daily["posts"].idxmax()]
    onset = p["ts"].min()
    first3 = p[(p["ts"] >= pd.Timestamp("2026-02-28", tz="UTC")) & (p["ts"] < pd.Timestamp("2026-03-03", tz="UTC"))]
    out = {
        "peak_post_day": str(peak_day["date"]), "peak_post_day_posts": int(peak_day["posts"]),
        "posts_first_72h_from_2026_02_28": int(len(first3)),
        "posts_before_2026_02_28": int((p["ts"] < pd.Timestamp("2026-02-28", tz="UTC")).sum()),
        "days_with_posts": int((daily["posts"] > 0).sum()),
        "first_post_utc": onset.isoformat(),
        "comment_peak_hour_et": int(hour_et.idxmax()),
        "comment_trough_hour_et": int(hour_et.idxmin()),
        "overnight_share_01_06_et": r(overnight, 3),
        "overnight_share_if_uniform": r(6 / 24, 3),
        "rayleigh_R": r(Rbar, 3), "rayleigh_z": r(z, 1), "rayleigh_p": float(f"{p_ray:.3g}"),
        "circular_mean_hour_et": r(mean_hour, 2),
        "n_timed_comments": int(n),
    }
    return out, daily, hourly


def source_ecology(p: pd.DataFrame) -> tuple[dict, pd.DataFrame]:
    dom = p["domain"].str.lower().str.replace(r"^www\.", "", regex=True)
    dom = dom.replace({"the-independent.com": "independent.co.uk"})   # same outlet, two hostnames
    vc = dom.value_counts()
    share = vc / vc.sum()
    table = pd.DataFrame({"domain": vc.index, "posts": vc.values, "share": share.values.round(4),
                          "median_score": [int(p.loc[dom == d, "score"].median()) for d in vc.index]})
    return {
        "distinct_domains": int(vc.size),
        "top1_domain": vc.index[0], "top1_share": r(share.iloc[0], 3),
        "top2_domain": vc.index[1], "top2_share": r(share.iloc[1], 3),
        "top5_share": r(share.iloc[:5].sum(), 3),
        "hhi": r((share**2).sum(), 4),
        "effective_number_of_outlets": r(1 / (share**2).sum(), 1),
        "singleton_domains": int((vc == 1).sum()),
    }, table


def engagement(p: pd.DataFrame, c: pd.DataFrame) -> dict:
    rho, pval = sps.spearmanr(p["score"], p["num_comments"])
    return {
        "post_score_median": int(p["score"].median()),
        "post_score_iqr": [int(p["score"].quantile(.25)), int(p["score"].quantile(.75))],
        "post_score_max": int(p["score"].max()),
        "post_score_min": int(p["score"].min()),
        "num_comments_median": int(p["num_comments"].median()),
        "num_comments_max": int(p["num_comments"].max()),
        "upvote_ratio_mean": r(p["upvote_ratio"].mean(), 3),
        "upvote_ratio_min": r(p["upvote_ratio"].min(), 2),
        "upvote_ratio_share_ge_095": r((p["upvote_ratio"] >= .95).mean(), 3),
        "spearman_score_comments": r(rho, 3), "spearman_score_comments_p": float(f"{pval:.3g}"),
        "comment_score_median": r(c.loc[c["is_analyzable"], "score"].median(), 1),
    }


def gini(x: np.ndarray) -> float:
    x = np.sort(np.asarray(x, dtype=float))
    n = x.size
    return float((2 * np.arange(1, n + 1) - n - 1).dot(x) / (n * x.sum()))


def participation(p: pd.DataFrame, c: pd.DataFrame) -> tuple[dict, np.ndarray, pd.Series]:
    human = c[c["is_analyzable"] & ~c["is_deleted_author"]]
    per_author = human.groupby("author").size().sort_values(ascending=False)
    threads = human.groupby("author")["post_id"].nunique()
    n_auth = per_author.size
    k1 = max(1, int(round(n_auth * .01)))
    k10 = max(1, int(round(n_auth * .10)))
    post_authors = set(p["author"]) - {"[deleted]"}
    out = {
        "pseudonymous_commenters": int(n_auth),
        "comments_by_identified_humans": int(per_author.sum()),
        "comments_per_author_mean": r(per_author.mean(), 2),
        "comments_per_author_max": int(per_author.max()),
        "gini": r(gini(per_author.values), 3),
        "top1pct_share": r(per_author.iloc[:k1].sum() / per_author.sum(), 3),
        "top10pct_share": r(per_author.iloc[:k10].sum() / per_author.sum(), 3),
        "single_comment_author_share": r((per_author == 1).mean(), 3),
        "authors_in_ge2_threads": int((threads >= 2).sum()),
        "authors_in_ge2_threads_share": r((threads >= 2).mean(), 3),
        "authors_in_ge5_threads": int((threads >= 5).sum()),
        "max_threads_by_one_author": int(threads.max()),
        "distinct_post_submitters": int(len(post_authors)),
        "submitters_with_ge2_posts": int((p.loc[p["author"] != "[deleted]", "author"].value_counts() >= 2).sum()),
        "max_posts_by_one_submitter": int(p.loc[p["author"] != "[deleted]", "author"].value_counts().max()),
        "submitters_who_also_comment": int(len(post_authors & set(per_author.index))),
    }
    return out, per_author.values, threads


def compile_frames() -> dict[str, re.Pattern]:
    lex = json.loads((PROTOCOL / "frame_lexicon.json").read_text(encoding="utf-8"))
    return {k: re.compile(r"\b(?:" + "|".join(v) + r")\b", re.IGNORECASE)
            for k, v in lex.items() if not k.startswith("_")}


def framing_and_sentiment(c: pd.DataFrame, rng: np.random.Generator):
    human = c[c["is_analyzable"]].copy()
    sia = SentimentIntensityAnalyzer()
    human["vader"] = [sia.polarity_scores(t)["compound"] for t in human["body"]]
    frames = compile_frames()
    for name, pat in frames.items():
        human[name] = human["body"].str.contains(pat)
    n = len(human)

    rows = []
    for name in frames:
        m = human[name]
        k = int(m.sum())
        lo, hi = wilson(k, n)
        rows.append({"frame": name, "comments": k, "share": round(k / n, 4), "ci_low": round(lo, 4),
                     "ci_high": round(hi, 4),
                     "mean_vader": round(human.loc[m, "vader"].mean(), 3) if k else None,
                     "median_comment_score": float(human.loc[m, "score"].median()) if k else None})
    frame_tab = pd.DataFrame(rows).sort_values("share", ascending=False).reset_index(drop=True)
    any_frame = human[list(frames)].any(axis=1).mean()

    # daily sentiment with percentile-bootstrap CIs (days with >= MIN_DAILY_N comments)
    human["day"] = human["ts"].dt.normalize()
    daily = []
    for day, g in human.groupby("day"):
        v = g["vader"].to_numpy()
        if v.size < MIN_DAILY_N:
            continue
        boots = rng.choice(v, size=(N_BOOT, v.size), replace=True).mean(axis=1)
        daily.append({"date": day.date(), "n": int(v.size), "mean_vader": round(v.mean(), 4),
                      "ci_low": round(np.percentile(boots, 2.5), 4), "ci_high": round(np.percentile(boots, 97.5), 4),
                      "share_negative": round((v <= -0.05).mean(), 4)})
    sent_daily = pd.DataFrame(daily)

    # daily frame shares for the most prevalent frames (used in Fig 5 inset / supplement)
    frame_daily = human.groupby("day")[list(frames)].mean()
    frame_daily = frame_daily[human.groupby("day").size() >= MIN_DAILY_N]

    v = human["vader"]
    rho, pval = sps.spearmanr(human["score"], human["vader"])
    trend_rho, trend_p = (sps.spearmanr(range(len(sent_daily)), sent_daily["mean_vader"])
                          if len(sent_daily) > 3 else (np.nan, np.nan))
    out = {
        "n_analyzable": int(n),
        "vader_mean": r(v.mean(), 3), "vader_median": r(v.median(), 3),
        "share_negative": r((v <= -0.05).mean(), 3), "share_positive": r((v >= 0.05).mean(), 3),
        "share_neutral": r(((v > -0.05) & (v < 0.05)).mean(), 3),
        "spearman_comment_score_vs_vader": r(rho, 3), "spearman_comment_score_vs_vader_p": float(f"{pval:.3g}"),
        "days_plotted": int(len(sent_daily)),
        "daily_mean_min": r(sent_daily["mean_vader"].min(), 3), "daily_mean_max": r(sent_daily["mean_vader"].max(), 3),
        "daily_trend_spearman": r(trend_rho, 3), "daily_trend_p": float(f"{trend_p:.3g}") if not np.isnan(trend_p) else None,
        "any_frame_share": r(any_frame, 3),
        "top_frame": frame_tab.iloc[0]["frame"], "top_frame_share": r(frame_tab.iloc[0]["share"], 3),
        "frames": {row.frame: {"share": r(row.share, 3), "mean_vader": r(row.mean_vader, 3)} for row in frame_tab.itertuples()},
    }
    return out, frame_tab, sent_daily, frame_daily, human


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (float("nan"), float("nan"))
    ph = k / n
    d = 1 + z**2 / n
    ctr = (ph + z**2 / (2 * n)) / d
    half = z * math.sqrt(ph * (1 - ph) / n + z**2 / (4 * n**2)) / d
    return ctr - half, ctr + half


def language_and_duplicates(c: pd.DataFrame) -> dict:
    human = c[c["is_analyzable"]]
    body = human["body"]

    def script_share(pattern):
        return int(body.str.contains(pattern).sum())

    spanish = 0
    for t in body:
        toks = re.findall(r"[a-záéíóúñü]+", t.lower())
        if len(toks) >= 6:
            es = sum(tok in SPANISH_MARKERS for tok in toks)
            en = sum(tok in {"the", "and", "is", "of", "to", "that", "it"} for tok in toks)
            if es >= 3 and es > en:
                spanish += 1

    def norm(t):
        t = unicodedata.normalize("NFKC", t.lower())
        t = re.sub(r"https?://\S+", " ", t)
        return re.sub(r"[^a-z0-9]+", " ", t).strip()

    normed = human.assign(n=body.map(norm))
    normed = normed[normed["n"].str.len() >= 40]           # ignore short stock phrases
    grp = normed.groupby("n").agg(copies=("id", "size"), authors=("author", "nunique"), threads=("post_id", "nunique"))
    dup = grp[grp["copies"] >= 2]
    return {
        "arabic_script_comments": script_share(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]"),
        "persian_specific_letters_comments": script_share(r"[پچژگ]"),
        "hebrew_script_comments": script_share(r"[֐-׿]"),
        "cyrillic_script_comments": script_share(r"[Ѐ-ӿ]"),
        "cjk_script_comments": script_share(r"[一-鿿぀-ヿ가-힯]"),
        "spanish_dominant_comments": int(spanish),
        "long_texts_considered": int(len(normed)),
        "duplicate_text_groups": int(len(dup)),
        "duplicate_groups_multi_author": int((dup["authors"] >= 2).sum()),
        "duplicate_groups_multi_thread": int((dup["threads"] >= 2).sum()),
        "max_copies_of_one_text": int(dup["copies"].max()) if len(dup) else 0,
    }


def term_frequencies(p: pd.DataFrame, human: pd.DataFrame, k: int = 25) -> pd.DataFrame:
    def toks(series):
        cnt = Counter()
        for t in series:
            t = re.sub(r"https?://\S+", " ", t.lower()).replace("’", "'")
            for w in re.findall(r"[a-z][a-z']{2,}", t):
                w = w.strip("'")
                if w.endswith("'s"):
                    w = w[:-2]
                if w not in STOPWORDS and len(w) > 2:
                    cnt[w] += 1
        return cnt
    tt, ct = toks(p["title"]), toks(human["body"])
    rows = []
    for i in range(k):
        a = tt.most_common(k)[i] if i < len(tt) else ("", 0)
        b = ct.most_common(k)[i] if i < len(ct) else ("", 0)
        rows.append({"rank": i + 1, "title_term": a[0], "title_count": a[1], "comment_term": b[0], "comment_count": b[1]})
    return pd.DataFrame(rows)


def cross_collection_overlap(cols: dict) -> pd.DataFrame | None:
    """Pseudonym overlap (Jaccard) among collections. Pseudonyms are deterministic
    across Thresh exports, so identical accounts map to identical pseudonyms."""
    if len(cols) < 2:
        return None
    sets = {}
    for name, col in cols.items():
        c = col["comments"]
        a = set(c.loc[c["is_analyzable"] & ~c["is_deleted_author"], "author"]) | (set(col["posts"]["author"]) - {"[deleted]"})
        sets[name] = a - {anonymize_js("AutoModerator")}
    rows = []
    names = sorted(sets)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            inter = len(sets[a] & sets[b])
            rows.append({"collection_a": a, "collection_b": b, "authors_a": len(sets[a]), "authors_b": len(sets[b]),
                         "shared": inter, "jaccard": round(inter / len(sets[a] | sets[b]), 4)})
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- #
# Figures
# --------------------------------------------------------------------------- #
ONSET = pd.Timestamp("2026-02-28", tz="UTC")


def fig_temporal(daily: pd.DataFrame, hourly: pd.DataFrame, temporal_stats: dict) -> None:
    fig, (a, b) = plt.subplots(1, 2, figsize=(7.0, 2.55), gridspec_kw={"width_ratios": [1.55, 1], "wspace": 0.28})
    d = pd.to_datetime(daily["date"])
    a.bar(d, daily["posts"], width=0.78, color=EMBER, edgecolor="white", linewidth=0.5, zorder=3)
    a.set_title("A  Posts per day (UTC)")
    a.set_ylabel("Posts")
    a.grid(axis="y", zorder=0)
    a.xaxis.set_major_locator(mdates.DayLocator(bymonthday=[21, 28, 7, 14]))
    a.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    a.axvline(ONSET.tz_localize(None) - pd.Timedelta(hours=12), color=RUST, lw=1, ls=(0, (3, 2)), zorder=4)
    a.annotate("28 Feb: US–Israeli\nstrikes on Iran begin", xy=(ONSET.tz_localize(None), daily["posts"].max() * 0.96),
               xytext=(6, 0), textcoords="offset points", fontsize=7.2, color=INK, va="top")
    a.set_xlim(d.min() - pd.Timedelta(days=0.8), d.max() + pd.Timedelta(days=0.8))

    share = hourly["comments_et"] / hourly["comments_et"].sum() * 100
    b.bar(hourly["hour"], share, width=0.8, color=BLUE, edgecolor="white", linewidth=0.5, zorder=3)
    b.axhline(100 / 24, color=MUTED, lw=0.8, ls=(0, (3, 2)), zorder=4)
    b.text(23.6, 100 / 24 + 0.15, "uniform", ha="right", va="bottom", fontsize=7, color=MUTED)
    b.set_title("B  Comments by hour (US Eastern)")
    b.set_ylabel("% of comments")
    b.set_xticks([0, 6, 12, 18, 23])
    b.set_xticklabels(["00", "06", "12", "18", "23"])
    b.set_xlabel("Hour of day")
    b.grid(axis="y", zorder=0)
    save(fig, "fig2_temporal")


def fig_sources_coverage(domain_tab: pd.DataFrame, p: pd.DataFrame, c: pd.DataFrame) -> None:
    fig, (a, b) = plt.subplots(1, 2, figsize=(7.0, 2.7), gridspec_kw={"width_ratios": [1, 1.1], "wspace": 0.55})
    top = domain_tab.head(10).iloc[::-1]
    a.barh(top["domain"], top["posts"], color=EMBER, edgecolor="white", linewidth=0.5, height=0.72, zorder=3)
    for y, (v, s) in enumerate(zip(top["posts"], top["share"])):
        a.text(v + 0.4, y, f"{v}", va="center", fontsize=7.2, color=INK)
    a.set_title("A  Linked outlets (top 10 of %d)" % len(domain_tab))
    a.set_xlabel("Posts")
    a.grid(axis="x", zorder=0)
    a.tick_params(axis="y", length=0)

    per = c.groupby("post_id").size().rename("captured")
    m = p.set_index("id").join(per)
    xs = np.logspace(np.log10(m["num_comments"].min() * 0.8), np.log10(m["num_comments"].max() * 1.2), 100)
    b.fill_between(xs, m["captured"].max(), xs, where=xs > m["captured"].max(), color=RUST, alpha=0.10, lw=0)
    b.plot(xs, xs, color=MUTED, lw=0.8, ls=(0, (3, 2)))
    b.text(xs[-1], m["captured"].max() * 2.2, "present on Reddit,\nabsent from export", ha="right",
           va="bottom", fontsize=7, color=RUST)
    b.text(xs[0] * 1.05, xs[0] * 3.2, "full capture\n(y = x)", fontsize=7, color=MUTED, va="bottom")
    b.set_ylim(m["captured"].min() * 0.8, xs[-1] * 1.1)
    b.scatter(m["num_comments"], m["captured"], s=16, color=BLUE, alpha=0.9, edgecolor="white", linewidth=0.5, zorder=3)
    b.set_xscale("log")
    b.set_yscale("log")
    b.set_xlabel("Comments Reddit reports on the post (log)")
    b.set_ylabel("Comments in export (log)")
    b.set_title("B  Per-thread capture ceiling")
    b.grid(True, which="major", zorder=0)
    fmt = matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:,.0f}")
    for ax in (b.xaxis, b.yaxis):
        ax.set_major_formatter(fmt)
        ax.set_minor_formatter(matplotlib.ticker.NullFormatter())
    save(fig, "fig3_sources_coverage")


def fig_participation(per_author: np.ndarray, threads: pd.Series, part: dict) -> None:
    fig, (a, b) = plt.subplots(1, 2, figsize=(7.0, 2.6), gridspec_kw={"wspace": 0.32})
    x = np.sort(per_author)
    cum = np.insert(np.cumsum(x) / x.sum(), 0, 0)
    pop = np.linspace(0, 1, cum.size)
    a.plot([0, 1], [0, 1], color=MUTED, lw=0.8, ls=(0, (3, 2)))
    a.plot(pop, cum, color=EMBER, lw=2)
    a.fill_between(pop, cum, pop, color=EMBER, alpha=0.12, lw=0)
    a.set_title("A  Concentration of commenting")
    a.set_xlabel("Cumulative share of commenters")
    a.set_ylabel("Cumulative share of comments")
    a.text(0.05, 0.9, f"Gini = {part['gini']:.2f}\nTop 10% of commenters\nwrite {part['top10pct_share']*100:.0f}% of comments",
           fontsize=7.4, color=INK, va="top", transform=a.transAxes)
    a.set_xlim(0, 1)
    a.set_ylim(0, 1)
    a.grid(True, zorder=0)

    vc = threads.value_counts().sort_index()
    bins = {"1": vc.get(1, 0), "2": vc.get(2, 0), "3–4": vc.loc[3:4].sum(), "5–9": vc.loc[5:9].sum(), "10+": vc.loc[10:].sum()}
    b.bar(list(bins), list(bins.values()), color=BLUE, edgecolor="white", linewidth=0.5, width=0.7, zorder=3)
    b.set_yscale("log")
    for i, v in enumerate(bins.values()):
        b.text(i, v * 1.15, f"{v:,}", ha="center", fontsize=7.2, color=INK)
    b.set_title("B  Threads each commenter entered")
    b.set_xlabel("Distinct threads")
    b.set_ylabel("Commenters (log)")
    b.set_ylim(top=max(bins.values()) * 3)
    b.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:,.0f}"))
    b.yaxis.set_minor_formatter(matplotlib.ticker.NullFormatter())
    b.grid(axis="y", zorder=0)
    save(fig, "fig4_participation")


def fig_frames_sentiment(frame_tab: pd.DataFrame, sent_daily: pd.DataFrame) -> None:
    fig, (a, b) = plt.subplots(1, 2, figsize=(7.0, 3.0), gridspec_kw={"width_ratios": [1.05, 1], "wspace": 0.62})
    t = frame_tab.iloc[::-1]
    y = np.arange(len(t))
    a.barh(y, t["share"] * 100, color=EMBER, edgecolor="white", linewidth=0.5, height=0.7, zorder=3)
    a.errorbar(t["share"] * 100, y, xerr=[(t["share"] - t["ci_low"]) * 100, (t["ci_high"] - t["share"]) * 100],
               fmt="none", ecolor=INK, elinewidth=0.7, capsize=1.5, zorder=4)
    a.set_yticks(y)
    a.set_yticklabels(t["frame"])
    a.tick_params(axis="y", length=0)
    a.set_xlabel("% of analyzable comments (95% CI)")
    a.set_title("A  Frame prevalence")
    a.grid(axis="x", zorder=0)

    sd = sent_daily.assign(date=pd.to_datetime(sent_daily["date"])).set_index("date")
    sd = sd.reindex(pd.date_range(sd.index.min(), sd.index.max(), freq="D"))   # NaN gaps break the line
    sent_daily = sd.reset_index(names="date")
    d = sent_daily["date"]
    b.fill_between(d, sent_daily["ci_low"], sent_daily["ci_high"], color=BLUE, alpha=0.18, lw=0)
    b.plot(d, sent_daily["mean_vader"], color=BLUE, lw=2, marker="o", ms=3.2, mec="white", mew=0.6)
    b.axhline(0, color=MUTED, lw=0.8)
    b.set_title("B  Daily mean comment sentiment")
    b.set_ylabel("VADER compound (95% CI)")
    b.xaxis.set_major_locator(mdates.DayLocator(bymonthday=[21, 28, 7, 14]))
    b.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    b.grid(axis="y", zorder=0)
    save(fig, "fig5_frames_sentiment")


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> int:
    for d in (FIGS, TABLES):
        d.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)

    folders = sorted(f for f in COLLECTIONS.iterdir() if (f / "posts.csv").exists())
    if not folders:
        log("no collections found under data/collections/")
        return 1
    cols = {}
    for f in folders:
        col = load_collection(f)
        col["comments"] = classify_comments(col["comments"])
        cols[f.name] = col
        log(f"loaded {f.name}: {len(col['posts'])} posts, {len(col['comments'])} comments")

    stats = {
        "_about": "Every number quoted in the manuscript. Regenerate with analysis/thresh_analysis.py.",
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "software": {"python": sys.version.split()[0], "pandas": pd.__version__, "numpy": np.__version__,
                     "scipy": __import__("scipy").__version__, "matplotlib": matplotlib.__version__,
                     "vaderSentiment": "3.3.2"},
        "seed": SEED, "n_bootstrap": N_BOOT, "primary": PRIMARY,
        "collections": {},
    }
    summary_rows = []
    for name, col in cols.items():
        p, c = col["posts"], col["comments"]
        s = {"checksums_sha256": col["checksums"], "audit": collection_audit(col),
             "governance": governance_footprint(p, c), "engagement": engagement(p, c)}
        s["temporal"], daily, hourly = temporal(p, c)
        s["sources"], domain_tab = source_ecology(p)
        s["participation"], per_author, threads = participation(p, c)
        s["framing_sentiment"], frame_tab, sent_daily, frame_daily, human = framing_and_sentiment(c, rng)
        s["language_duplication"] = language_and_duplicates(c)
        terms = term_frequencies(p, human)
        stats["collections"][name] = s

        tag = name
        daily.to_csv(TABLES / f"{tag}__daily_volume.csv", index=False)
        hourly.to_csv(TABLES / f"{tag}__hourly_comments.csv", index=False)
        domain_tab.to_csv(TABLES / f"{tag}__domains.csv", index=False)
        frame_tab.to_csv(TABLES / f"{tag}__frames.csv", index=False)
        sent_daily.to_csv(TABLES / f"{tag}__daily_sentiment.csv", index=False)
        frame_daily.round(4).to_csv(TABLES / f"{tag}__daily_frame_shares.csv")
        terms.to_csv(TABLES / f"{tag}__top_terms.csv", index=False)
        # Headlines are published news titles (not user speech) and are safe to list.
        p.sort_values("score", ascending=False)[["id", "created_date", "score", "upvote_ratio", "num_comments",
                                                  "domain", "flair", "title"]].head(10).to_csv(
            TABLES / f"{tag}__top10_headlines.csv", index=False)

        a, g, e, pa, fs = s["audit"], s["governance"], s["engagement"], s["participation"], s["framing_sentiment"]
        summary_rows.append({
            "collection": name, "subreddit(s)": a["subreddits"], "keyword": a["keyword"], "sort": a["sort"],
            "time_filter": a["time_filter"], "posts": a["posts_observed"], "comments": a["comments_observed"],
            "coverage_overall": a["coverage_overall"], "bot_share": g["bot_comment_share"],
            "removed_or_deleted_share": g["removed_or_deleted_share"], "commenters": pa["pseudonymous_commenters"],
            "gini": pa["gini"], "upvote_ratio_mean": e["upvote_ratio_mean"], "vader_mean": fs["vader_mean"],
            "share_negative": fs["share_negative"],
        })

        if name == PRIMARY:
            fig_temporal(daily, hourly, s["temporal"])
            fig_sources_coverage(domain_tab, p, c)
            fig_participation(per_author, threads, s["participation"])
            fig_frames_sentiment(frame_tab, sent_daily)

    pd.DataFrame(summary_rows).to_csv(TABLES / "collections_summary.csv", index=False)
    ov = cross_collection_overlap(cols)
    if ov is not None:
        ov.to_csv(TABLES / "cross_collection_author_overlap.csv", index=False)
        stats["cross_collection_overlap"] = ov.to_dict(orient="records")

    # Tool verification (run verify_tool.js first; merged here if present)
    tv = RESULTS / "tool_verification.json"
    if tv.exists():
        stats["tool_verification"] = json.loads(tv.read_text(encoding="utf-8"))

    # Sampling frame summary
    sf = pd.read_csv(PROTOCOL / "sampling_frame.csv") if (PROTOCOL / "sampling_frame.csv").exists() else \
        pd.read_csv(PROTOCOL / "sampling_frame_source.csv")
    stats["sampling_frame"] = {k: int(v) for k, v in sf["tier"].value_counts().items()}

    (RESULTS / "stats.json").write_text(json.dumps(stats, indent=2, default=str), encoding="utf-8")
    log("stats → results/stats.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
