#!/usr/bin/env python3
"""Generate banner-light.svg and banner-dark.svg: charcheck's "glyph grid" banner.

A code chart of ordinary characters, with the characters this repo bans picked out in
place, and the wordmark set in a merged cell. All text is converted to outlines from
JetBrains Mono, so the SVGs need no font at view time.

Run from anywhere:  python3 assets/banner/generate.py
Needs fontTools and the JetBrains Mono (Nerd Font) TTFs; override their location with
CHARCHECK_FONT_DIR.

The repo checks itself for banned characters, so this file never contains one literally:
every code point below is a number, and glyphs are drawn from the font by code point.
"""

import os
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont

OUT = Path(__file__).resolve().parent
FONT_DIR = Path(os.environ.get("CHARCHECK_FONT_DIR", "/usr/share/fonts/TTF"))
REGULAR = TTFont(FONT_DIR / "JetBrainsMonoNerdFont-Regular.ttf")
BOLD = TTFont(FONT_DIR / "JetBrainsMonoNerdFont-Bold.ttf")
ADV = 600  # JetBrains Mono advance, units per em is 1000

W, H = 1280, 320
CELL = 40
COLS, ROWS = 31, 7
GX, GY = (W - COLS * CELL) // 2, (H - ROWS * CELL) // 2
# The merged cell that holds the wordmark, in grid coordinates (inclusive).
PANEL = (1, 1, 17, 5)  # col0, row0, col1, row1

TAGLINE = "Ban a character once, catch it everywhere."

# The repo's own banned set (charcheck.config.js): dashes and invisibles.
BANNED = {0x2014, 0x2015, 0x00AD, 0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x2060}

# Characters with no visible glyph get a dashed box and their chart abbreviation.
FORMAT = {
    0x00A0: "NBSP", 0x00AD: "SHY",
    0x2000: "NQSP", 0x2001: "MQSP", 0x2002: "ENSP", 0x2003: "EMSP", 0x2004: "3/MSP",
    0x2005: "4/MSP", 0x2006: "6/MSP", 0x2007: "FSP", 0x2008: "PSP", 0x2009: "THSP",
    0x200A: "HSP", 0x200B: "ZWSP", 0x200C: "ZWNJ", 0x200D: "ZWJ", 0x200E: "LRM",
    0x200F: "RLM", 0x2060: "WJ",
}

THEMES = {
    "dark": dict(
        card="#1a1b26", edge="#292e42", line="#232433", glyph="#565f89", label="#3b4261",
        word="#c0caf5", tag="#a9b1d6", box="#414868", dash="#f7768e", invis="#ff9e64",
        scan="#7dcfff",
    ),
    "light": dict(
        card="#e1e2e7", edge="#c4c8da", line="#d3d6e2", glyph="#848cb5", label="#b4b8cf",
        word="#3760bf", tag="#6172b0", box="#a8aecb", dash="#f52a65", invis="#b15c00",
        scan="#007197",
    ),
}

# Timing, in seconds. The scene loops: GitHub caches the image, so a one-shot animation
# would only play on a hard refresh. The finished frame holds for HOLD before the flags
# fade over FADE and the scan runs again.
SCAN_START, SCAN_DUR = 0.5, 2.0
HIT_DUR = 0.6
HOLD, FADE = 10.0, 0.4
CYCLE = SCAN_START + SCAN_DUR + HIT_DUR + HOLD + FADE


def pct(t):
    return f"{t / CYCLE * 100:.3f}".rstrip("0").rstrip(".") + "%"


def num(v):
    v = round(v, 2)
    return str(int(v)) if v == int(v) else f"{v:.2f}".rstrip("0")


class PathPen(BasePen):
    """Glyph outline in font units, y flipped to point down, integers only."""

    def __init__(self, glyphset):
        super().__init__(glyphset)
        self.d = []

    def _pt(self, p):
        return f"{round(p[0])} {round(-p[1])}"

    def _moveTo(self, p):
        self.d.append("M" + self._pt(p))

    def _lineTo(self, p):
        self.d.append("L" + self._pt(p))

    def _curveToOne(self, a, b, c):
        self.d.append("C" + " ".join(map(self._pt, (a, b, c))))

    def _qCurveToOne(self, a, b):
        self.d.append("Q" + " ".join(map(self._pt, (a, b))))

    def _closePath(self):
        self.d.append("Z")


class Glyphs:
    """Collects each glyph once into <defs>; text is then a run of <use>."""

    def __init__(self):
        self.defs = {}

    def ref(self, font, cp):
        tag = "b" if font is BOLD else "r"
        gid = f"{tag}{cp:x}"
        if gid not in self.defs:
            gs = font.getGlyphSet()
            name = font.getBestCmap()[cp]
            pen = PathPen(gs)
            gs[name].draw(pen)
            self.defs[gid] = "".join(pen.d)
        return gid if self.defs[gid] else None

    def text(self, s, x, y, size, font=REGULAR, anchor="start"):
        """<use> elements for string s at baseline (x, y), inside a scale(size/1000) group."""
        k = size / 1000
        width = len(s) * ADV
        x0 = x / k - (width / 2 if anchor == "middle" else 0)
        out = []
        for i, ch in enumerate(s):
            if ch == " ":
                continue
            gid = self.ref(font, ord(ch))
            if gid:
                out.append(f'<use href="#{gid}" x="{round(x0 + i * ADV)}" y="{round(y / k)}"/>')
        return f'<g transform="scale({k:.5g})">{"".join(out)}</g>'

    def render(self):
        return "".join(f'<path id="{k}" d="{d}"/>' for k, d in self.defs.items() if d)


def has(cp):
    return cp in REGULAR.getBestCmap() or cp == 0x2015


def chart_sequence():
    """Code points in chart order. Missing glyphs are skipped, format characters kept."""
    ranges = [
        (0x00A0, 0x00BF),
        (0x2000, 0x2027),
        (0x2030, 0x203E),
        (0x2060, 0x2060),
    ]
    seq = []
    for lo, hi in ranges:
        seq += [c for c in range(lo, hi + 1) if c in FORMAT or has(c)]
    return seq


def slots():
    """Visible cells, column-major, split into those left of and right of the panel's end."""
    c0, r0, c1, r1 = PANEL
    left, right = [], []
    for c in range(COLS):
        for r in range(ROWS):
            if c0 <= c <= c1 and r0 <= r <= r1:
                continue
            (left if c <= c1 else right).append((c, r))
    # The left side reads as two lines of text, so it fills row by row.
    left.sort(key=lambda cr: (cr[1], cr[0]))
    return left, right


def build(theme):
    t = THEMES[theme]
    g = Glyphs()
    left, right = slots()
    tail = chart_sequence()
    # The right side ends on the chart run that holds the banned characters; ASCII fills
    # whatever room is left in front of it, continuing from where the left side stopped.
    ascii_cps = list(range(0x21, 0x7F))
    lead = len(right) - len(tail)
    assert lead >= 0, "chart run does not fit the right side"
    cells = list(zip(left, ascii_cps)) + list(zip(right, ascii_cps[-lead:] + tail if lead else tail))

    base_glyphs, labels, boxes, hits, hit_css = [], [], [], [], []
    # The scan emerges from behind the merged cell and sweeps the chart run to its right.
    x_lo, x_hi = GX + (PANEL[2] + 1) * CELL, GX + COLS * CELL
    for (c, r), cp in cells:
        x, y = GX + c * CELL, GY + r * CELL
        cx = x + CELL / 2
        banned = cp in BANNED
        hexs = f"{cp:04X}"
        if cp in FORMAT:
            abbr = FORMAT[cp]
            box = (
                f'<rect x="{num(cx - 15)}" y="{y + 6}" width="30" height="18" rx="2"/>'
            )
            boxes.append(box)
            content = g.text(abbr, cx, y + 18, 7, anchor="middle")
            labels.append(content)
        elif cp == 0x2015:
            # Not in JetBrains Mono. A horizontal bar is a dash that overruns the advance.
            content = f'<rect x="{num(cx - 11)}" y="{num(y + 15.6)}" width="22" height="2.1"/>'
            base_glyphs.append(content)
        else:
            # The banned dashes are set larger: at chart size an em dash is a 12px sliver.
            size = 26 if banned else 20
            content = g.text(chr(cp), cx, y + 22 + (size - 20) * 0.33, size, anchor="middle")
            base_glyphs.append(content)
        label = g.text(hexs, cx, y + 35, 7, anchor="middle")
        # Banned cells are drawn plain underneath too, so before the scan reaches them they
        # look like every other cell, and the highlight lands on top.
        labels.append(label)
        if not banned:
            continue
        color = t["invis"] if cp in FORMAT else t["dash"]
        delay = SCAN_START + SCAN_DUR * (cx - x_lo) / (x_hi - x_lo) - 0.05
        body = []
        body.append(
            f'<rect class="fill" x="{x + 1.5}" y="{y + 1.5}" width="{CELL - 3}" height="{CELL - 3}" rx="3"/>'
        )
        if cp in FORMAT:
            body.append(
                f'<rect class="dbox" x="{num(cx - 15)}" y="{y + 6}" width="30" height="18" rx="2"/>'
            )
        body.append(content)
        body.append(label)
        # The flag: a corner tab like a lint marker in a gutter.
        body.append(f'<path class="flag" d="M{x + CELL - 10.5} {y + 1.5}h7.5q1.5 0 1.5 1.5v7.5z"/>')
        # Each flag gets its own keyframes over the shared cycle, so all of them clear
        # together before the next sweep instead of one by one as the scan reaches them.
        name = f"h{len(hits)}"
        hit_css.append(
            f"@keyframes {name}{{0%,{pct(delay)}{{opacity:0;transform:scale(1.25)}}"
            f"{pct(delay + HIT_DUR * 0.55)}{{opacity:1}}"
            f"{pct(delay + HIT_DUR)},{pct(CYCLE - FADE)}{{opacity:1;transform:none}}"
            f"100%{{opacity:0;transform:none}}}}"
            f".{name}{{animation-name:{name}}}"
        )
        hits.append(
            f'<g class="hit {name}" fill="{color}" stroke="{color}">{"".join(body)}</g>'
        )

    # Grid lines: every cell edge, then the panel is painted over them as a merged cell.
    lines = []
    for c in range(COLS + 1):
        lines.append(f"M{GX + c * CELL} {GY}v{ROWS * CELL}")
    for r in range(ROWS + 1):
        lines.append(f"M{GX} {GY + r * CELL}h{COLS * CELL}")

    c0, r0, c1, r1 = PANEL
    px, py = GX + c0 * CELL, GY + r0 * CELL
    pw, ph = (c1 - c0 + 1) * CELL, (r1 - r0 + 1) * CELL
    pad = 30
    word_size = (pw - 2 * pad) / (len("charcheck") * ADV / 1000)
    word = g.text("charcheck", px + pad - 4, py + 118, word_size, font=BOLD)
    tag = g.text(TAGLINE, px + pad, py + 170, (pw - 2 * pad) / (len(TAGLINE) * ADV / 1000))

    scan_w = 120
    css = f"""
.hit{{transform-box:fill-box;transform-origin:center;animation:{CYCLE:g}s cubic-bezier(.2,.7,.3,1) infinite}}
.hit .fill{{fill-opacity:.13;stroke-width:1.5}}
.hit .dbox{{fill:none;stroke-width:1.2;stroke-dasharray:3 2}}
.hit g,.hit .flag{{stroke:none}}
.scan{{opacity:0;animation:scan {CYCLE:g}s linear infinite}}
@keyframes scan{{0%,{pct(SCAN_START)}{{opacity:0;transform:translateX(0)}}{pct(SCAN_START + SCAN_DUR * .06)},{pct(SCAN_START + SCAN_DUR * .9)}{{opacity:1}}{pct(SCAN_START + SCAN_DUR)},100%{{opacity:0;transform:translateX({x_hi - x_lo}px)}}}}
{"".join(hit_css)}
@media (prefers-reduced-motion:reduce){{.hit,.scan{{animation:none}}}}
""".strip().replace("\n", "")

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t">
<title id="t">charcheck: {TAGLINE}</title>
<style>{css}</style>
<defs><linearGradient id="sg" x1="0" x2="1"><stop offset="0" stop-color="{t['scan']}" stop-opacity="0"/><stop offset=".85" stop-color="{t['scan']}" stop-opacity=".18"/><stop offset="1" stop-color="{t['scan']}" stop-opacity=".75"/></linearGradient>
<clipPath id="cl"><rect x="{GX}" y="{GY}" width="{COLS * CELL}" height="{ROWS * CELL}"/></clipPath>
{g.render()}</defs>
<rect x=".5" y=".5" width="{W - 1}" height="{H - 1}" rx="14" fill="{t['card']}" stroke="{t['edge']}"/>
<path d="{''.join(lines)}" stroke="{t['line']}" fill="none"/>
<g fill="{t['glyph']}">{''.join(base_glyphs)}</g>
<g fill="none" stroke="{t['box']}" stroke-dasharray="3 2">{''.join(boxes)}</g>
<g fill="{t['label']}">{''.join(labels)}</g>
<g clip-path="url(#cl)"><rect class="scan" x="{x_lo - scan_w}" y="{GY}" width="{scan_w}" height="{ROWS * CELL}" fill="url(#sg)"/></g>
<g>{''.join(hits)}</g>
<rect x="{px}" y="{py}" width="{pw}" height="{ph}" fill="{t['card']}" stroke="{t['line']}"/>
<g fill="{t['word']}">{word}</g>
<g fill="{t['tag']}">{tag}</g>
</svg>
"""
    return svg


def main():
    for theme in THEMES:
        path = OUT / f"banner-{theme}.svg"
        path.write_text(build(theme))
        print(f"{path.relative_to(OUT.parents[1])}  {path.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
