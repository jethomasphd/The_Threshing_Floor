#!/usr/bin/env python3
"""
embed_fonts.py — Embed the manuscript typefaces into a .docx (ECMA-376 obfuscated fonts).

Why: the manuscript is set in IBM Plex Sans / Mono and Cormorant Garamond
(SIL Open Font License). Embedding them means the document renders as designed
in Microsoft Word and LibreOffice even where the fonts are not installed.

How: each font is subset to the Latin, punctuation, Greek and math ranges the
document uses (fontTools), obfuscated per ECMA-376 Part 1 §17.8.1 (the first 32
bytes XOR-ed with the reversed bytes of a GUID key), stored as
word/fonts/fontN.odttf, and referenced from word/fontTable.xml.

Usage:  python embed_fonts.py <in.docx> [out.docx]   (in-place if out omitted)
Requires: fonttools  (pip install fonttools)
"""
from __future__ import annotations

import io
import re
import sys
import uuid
import zipfile
from pathlib import Path

import logging

from fontTools import subset

logging.getLogger("fontTools.subset").setLevel(logging.ERROR)
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
FONTS = HERE / "fonts"

# family name as used in the document → {slot: file}
EMBED = {
    "IBM Plex Sans": {"embedRegular": "IBMPlexSans-Regular.ttf", "embedBold": "IBMPlexSans-Bold.ttf",
                      "embedItalic": "IBMPlexSans-Italic.ttf", "embedBoldItalic": "IBMPlexSans-SemiBoldItalic.ttf"},
    "IBM Plex Sans SmBld": {"embedRegular": "IBMPlexSans-SemiBold.ttf", "embedItalic": "IBMPlexSans-SemiBoldItalic.ttf"},
    "IBM Plex Mono": {"embedRegular": "IBMPlexMono-Regular.ttf"},
    "Cormorant Garamond SemiBold": {"embedRegular": "CormorantGaramond-SemiBold.ttf",
                                    "embedItalic": "CormorantGaramond-SemiBoldItalic.ttf"},
    "Cormorant Garamond": {"embedRegular": "CormorantGaramond-Regular.ttf", "embedItalic": "CormorantGaramond-Italic.ttf"},
}
SLOT_ORDER = ["embedRegular", "embedBold", "embedItalic", "embedBoldItalic"]
UNICODES = "U+0020-007E,U+00A0-017F,U+0192,U+02C6-02DC,U+0300-036F,U+0370-03FF,U+2000-206F,U+20AC,U+2100-215F," \
           "U+2190-21FF,U+2200-22FF,U+25A0-25FF,U+FB01-FB02"
REL_FONT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font"
CT_ODTTF = "application/vnd.openxmlformats-officedocument.obfuscatedFont"


def subset_font(path: Path) -> bytes:
    font = TTFont(str(path))
    opts = subset.Options()
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.layout_features = ["*"]
    opts.notdef_outline = True
    opts.hinting = False
    opts.legacy_kern = True
    sub = subset.Subsetter(options=opts)
    sub.populate(unicodes=subset.parse_unicodes(UNICODES))
    sub.subset(font)
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


def obfuscate(data: bytes, guid: str) -> bytes:
    hexstr = guid.strip("{}").replace("-", "")
    key = bytes(int(hexstr[i:i + 2], 16) for i in range(30, -1, -2))   # reversed byte order
    head = bytes(b ^ key[i % 16] for i, b in enumerate(data[:32]))
    return head + data[32:]


def main(src: str, dst: str | None = None) -> None:
    dst = dst or src
    zin = zipfile.ZipFile(src)
    parts = {n: zin.read(n) for n in zin.namelist()}
    zin.close()

    font_table = parts["word/fontTable.xml"].decode("utf-8")
    if 'xmlns:r="' not in font_table.split(">", 2)[1]:
        font_table = font_table.replace("<w:fonts ", '<w:fonts xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ', 1)
    font_table = re.sub(r"<w:fonts\b([^>]*?)\s*/>", r"<w:fonts\1></w:fonts>", font_table, count=1)  # self-closing root
    rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">']
    n = 0
    for family, slots in EMBED.items():
        embeds = []
        for slot in SLOT_ORDER:
            if slot not in slots:
                continue
            n += 1
            guid = "{" + str(uuid.uuid4()).upper() + "}"
            data = obfuscate(subset_font(FONTS / slots[slot]), guid)
            parts[f"word/fonts/font{n}.odttf"] = data
            rels.append(f'<Relationship Id="rIdF{n}" Type="{REL_FONT}" Target="fonts/font{n}.odttf"/>')
            embeds.append(f'<w:{slot} r:id="rIdF{n}" w:fontKey="{guid}"/>')
        pat = re.compile(r'<w:font w:name="%s">(.*?)</w:font>' % re.escape(family), re.S)
        m = pat.search(font_table)
        if m:
            inner = re.sub(r"<w:embed(?:Regular|Bold|Italic|BoldItalic)[^>]*/>", "", m.group(1))
            font_table = font_table[:m.start()] + f'<w:font w:name="{family}">{inner}{"".join(embeds)}</w:font>' + font_table[m.end():]
        else:
            font_table = font_table.replace(
                "</w:fonts>",
                f'<w:font w:name="{family}"><w:charset w:val="00"/><w:family w:val="auto"/><w:pitch w:val="variable"/>'
                f'{"".join(embeds)}</w:font></w:fonts>')
    rels.append("</Relationships>")
    parts["word/fontTable.xml"] = font_table.encode("utf-8")
    parts["word/_rels/fontTable.xml.rels"] = "".join(rels).encode("utf-8")

    ct = parts["[Content_Types].xml"].decode("utf-8")
    if 'Extension="odttf"' not in ct:
        ct = ct.replace("<Default ", f'<Default Extension="odttf" ContentType="{CT_ODTTF}"/><Default ', 1)
    parts["[Content_Types].xml"] = ct.encode("utf-8")

    settings = parts["word/settings.xml"].decode("utf-8")
    if "embedTrueTypeFonts" not in settings:
        # schema order: embedTrueTypeFonts follows these elements when present
        preds = ["writeProtection", "view", "zoom", "removePersonalInformation", "removeDateAndTime",
                 "doNotDisplayPageBoundaries", "displayBackgroundShape", "printPostScriptOverText",
                 "printFractionalCharacterWidth", "printFormsData"]
        pos = re.search(r"<w:settings[^>]*>", settings).end()
        for tag in preds:
            m = re.search(r"<w:%s\b[^>]*?(?:/>|>.*?</w:%s>)" % (tag, tag), settings, re.S)
            if m:
                pos = max(pos, m.end())
        settings = settings[:pos] + "<w:embedTrueTypeFonts/>" + settings[pos:]
    parts["word/settings.xml"] = settings.encode("utf-8")

    order = ["[Content_Types].xml"] + [k for k in parts if k != "[Content_Types].xml"]
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for name in order:
            zout.writestr(name, parts[name])
    print(f"[thresh] embedded {n} font faces → {Path(dst).name}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(*sys.argv[1:3])
