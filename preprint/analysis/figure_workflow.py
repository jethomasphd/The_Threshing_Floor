#!/usr/bin/env python3
"""
figure_workflow.py — Draws Figure 1: the Thresh v2 human-in-the-loop data path.

A schematic, not a data figure. It encodes three architectural facts that the
manuscript argues from:
  (1) the only party that requests Reddit is the researcher's own browser;
  (2) parsing, analysis and export happen client-side, inside the browser;
  (3) the only Thresh-operated server is the optional AI Worker, which receives
      a sample of post titles/bodies (never usernames) only when AI features are used.

Usage:  python preprint/analysis/figure_workflow.py
"""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

# Typeface: IBM Plex Sans (bundled, SIL OFL) so figures match the manuscript; DejaVu Sans fallback.
from matplotlib import font_manager as _fm
for _ttf in (Path(__file__).resolve().parent.parent / "manuscript" / "fonts").glob("IBMPlexSans-*.ttf"):
    _fm.fontManager.addfont(str(_ttf))
FONT_FAMILY = ["IBM Plex Sans", "DejaVu Sans"]

OUT = Path(__file__).resolve().parent.parent / "results" / "figures"
INK, MUTED, EMBER, EMBER_BG, BLUE, RUST = "#23232B", "#6B6B7B", "#B08A1E", "#F6F0DE", "#2F6DB0", "#B5452F"

plt.rcParams.update({"font.family": FONT_FAMILY, "savefig.dpi": 300})
fig, ax = plt.subplots(figsize=(7.0, 3.7))
ax.set_xlim(0, 100)
ax.set_ylim(0, 52)
ax.axis("off")


def box(x, y, w, h, title, body, fc="white", ec=INK, lw=0.9, tc=INK, num=None):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.25,rounding_size=1.2", fc=fc, ec=ec, lw=lw))
    ty = y + h - 2.1
    if num:
        ax.add_patch(plt.Circle((x + 2.4, ty - 0.1), 1.55, color=EMBER, zorder=5))
        ax.text(x + 2.4, ty - 0.15, num, ha="center", va="center", fontsize=7.5, color="white", weight="bold", zorder=6)
        ax.text(x + 4.6, ty, title, ha="left", va="center", fontsize=8.2, weight="bold", color=tc)
    else:
        ax.text(x + w / 2, ty, title, ha="center", va="center", fontsize=8.2, weight="bold", color=tc)
    ax.text(x + w / 2 if not num else x + 1.2, y + (h - 3.6) / 2, body, ha="center" if not num else "left",
            va="center", fontsize=6.9, color=INK, linespacing=1.3)


def arrow(p, q, color=INK, ls="-", lw=1.0, rad=0.0):
    ax.add_patch(FancyArrowPatch(p, q, arrowstyle="-|>", mutation_scale=9, color=color, lw=lw, linestyle=ls,
                                 connectionstyle=f"arc3,rad={rad}", shrinkA=2, shrinkB=2))


# Browser boundary
ax.add_patch(FancyBboxPatch((1.2, 1.2), 75.5, 49.0, boxstyle="round,pad=0.2,rounding_size=2", fc="#FBFAF7",
                            ec=EMBER, lw=1.1, ls=(0, (4, 2))))
ax.text(2.8, 48.4, "THE RESEARCHER'S OWN BROWSER  ·  client-side only", fontsize=6.8, color=EMBER,
        weight="bold", va="center")

# Row 1 — the manual harvest
box(3.5, 27.5, 21.0, 14.0, "Set query", "Thresh builds the\nexact Reddit .json\nURL (sort, window,\nkeyword, limit)", num="1")
box(28.5, 27.5, 21.0, 14.0, "Gather", "Researcher opens it\nin a normal tab,\nselects all, copies;\n100 posts per page", num="2")
box(53.5, 27.5, 21.0, 14.0, "Paste", "reddit.js parses\nlocally; specific,\nplain-language\nerror messages", num="3")
arrow((24.8, 34.5), (28.2, 34.5))
arrow((49.8, 34.5), (53.2, 34.5))

# Row 2 — downstream
box(3.5, 5.0, 16.0, 14.0, "Harvest", "Tables, stats;\ncomments per\npost, by hand", fc=EMBER_BG, ec=EMBER)
box(22.5, 5.0, 16.0, 14.0, "Winnow", "Volume, word\nfrequency;\noptional AI", fc=EMBER_BG, ec=EMBER)
box(41.5, 5.0, 16.0, 14.0, "Glean", "CSV / JSON;\npseudonymized\nby default", fc=EMBER_BG, ec=EMBER)
box(60.5, 5.0, 14.0, 14.0, "Seal", "ZIP:\ndata +\nprovenance.txt", fc="white", ec=EMBER, lw=1.4)
arrow((19.8, 12), (22.2, 12))
arrow((38.8, 12), (41.2, 12))
arrow((57.8, 12), (60.2, 12))
ax.plot([64.0, 64.0, 11.5, 11.5], [27.2, 23.3, 23.3, 20.0], color=MUTED, lw=1.0)
arrow((11.5, 20.6), (11.5, 19.5), color=MUTED)

# Outside the browser
box(80.5, 27.5, 18.0, 14.0, "reddit.com", "Public .json pages\nserved to a person.\nNo API key,\nno proxy", ec=BLUE, tc=BLUE)
box(80.5, 5.0, 18.0, 14.0, "AI Worker", "Optional; the only\nThresh server. Gets\n≤50 titles/bodies,\nno usernames", ec=MUTED, tc=MUTED)
ax.plot([39.0, 39.0, 89.5], [42.0, 45.3, 45.3], color=BLUE, lw=1.0)
arrow((89.5, 45.9), (89.5, 42.0), color=BLUE)
ax.text(64.0, 46.2, "GET — the researcher's own click", fontsize=6.3, color=BLUE, ha="center", va="bottom")
arrow((80.2, 31.0), (74.8, 31.0), color=BLUE, ls=(0, (3, 2)))
ax.text(77.6, 29.6, "copy", fontsize=5.8, color=BLUE, ha="center", va="top")
ax.plot([30.5, 30.5, 78.0], [4.7, 2.6, 2.6], color=MUTED, lw=0.9, ls=(0, (2, 2)))
arrow((78.0, 2.6), (80.3, 8.0), color=MUTED, ls=(0, (2, 2)))
ax.text(54.0, 3.1, "only if AI features are used", fontsize=5.8, color=MUTED, ha="center", va="bottom")

for ext in ("png", "pdf"):
    fig.savefig(OUT / f"fig1_workflow.{ext}", bbox_inches="tight", pad_inches=0.03, facecolor="white")
print("[thresh] figure → results/figures/fig1_workflow.png")
