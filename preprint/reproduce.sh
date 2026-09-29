#!/usr/bin/env bash
# reproduce.sh — Regenerate every artefact of the preprint from the data, in order.
#
#   1. verify_tool.js       run Thresh's own code; write sampling-frame URLs + verification report
#   2. figure_workflow.py   draw Figure 1
#   3. thresh_analysis.py   all statistics, tables, Figures 2–5  → results/
#   4. build_manuscript.js  typeset manuscript + supplement (.docx) from results/stats.json
#   5. embed_fonts.py       embed the typefaces so the .docx renders as designed anywhere
#   6. (optional) PDF       if LibreOffice is installed
#
# Requirements: Python >= 3.10 (pip install -r requirements.txt), Node.js >= 18.
# Usage:  bash preprint/reproduce.sh        (from anywhere)
set -euo pipefail
cd "$(dirname "$0")"

echo "── 1/6  Verifying The Threshing Floor's own code"
node analysis/verify_tool.js

echo "── 2/6  Figure 1 (workflow)"
python3 analysis/figure_workflow.py

echo "── 3/6  Analysis"
python3 analysis/thresh_analysis.py

echo "── 4/6  Typesetting"
( cd manuscript && { [ -d node_modules/docx ] || npm install --silent --no-audit --no-fund; } && node build_manuscript.js )

echo "── 5/6  Embedding fonts"
for f in Thomas_2026_The_Threshing_Floor_preprint.docx Thomas_2026_The_Threshing_Floor_supplement.docx; do
  python3 manuscript/embed_fonts.py "$f"
done

echo "── 6/6  PDF (optional)"
if command -v soffice >/dev/null 2>&1; then
  PROFILE="$(mktemp -d)"
  soffice -env:UserInstallation="file://$PROFILE" --headless --convert-to pdf --outdir . \
    Thomas_2026_The_Threshing_Floor_preprint.docx Thomas_2026_The_Threshing_Floor_supplement.docx >/dev/null 2>&1 \
    && echo "PDFs written." || echo "LibreOffice present but conversion failed (needs the Writer component); .docx files are complete."
  rm -rf "$PROFILE"
else
  echo "LibreOffice not found — skipping PDF; the .docx files are complete."
fi

echo "── Checksums"
( cd data/collections && for d in */; do ( cd "$d" && sha256sum -c SHA256SUMS --quiet && echo "  ${d%/}: inputs verified" ); done )
echo "Done. The grain is threshed."
