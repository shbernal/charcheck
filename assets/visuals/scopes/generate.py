#!/usr/bin/env python3
"""Generates scopes-light.svg and scopes-dark.svg: which part of a file each scope reads.

Run from anywhere: python3 assets/visuals/scopes/generate.py
Needs fontTools and JetBrains Mono (the Nerd Font build is fine). Every piece of text is
converted to outlines, so the SVGs carry no font dependency and no literal banned character.

The animation cycles three phases per file (the .md file holds `markdown` through the last
two). Each element's resting style is the last phase, `strings` beside `markdown`, so a
renderer without CSS animation shows that view.
"""

import os
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_CANDIDATES = [
    "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Regular.ttf",
    "/usr/share/fonts/TTF/JetBrainsMono-Regular.ttf",
    "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf",
]
DASH = "\u2014"  # built from its code point: this repo bans the literal

THEMES = {
    "dark": dict(
        panel="#1a1b26", bar="#16161e", border="#292e42", fg="#c0caf5", muted="#737aa2",
        comment="#737aa2", red="#f7768e", orange="#ff9e64", green="#9ece6a", cyan="#7dcfff",
        blue="#7aa2f7", purple="#bb9af7", tint="#7aa2f7", tint_op="0.16", legend="#a9b1d6",
    ),
    "light": dict(
        panel="#e1e2e7", bar="#d0d5e3", border="#c4c8da", fg="#3760bf", muted="#6172b0",
        comment="#848cb5", red="#f52a65", orange="#b15c00", green="#587539", cyan="#007197",
        blue="#2e7de9", purple="#9854f1", tint="#2e7de9", tint_op="0.13", legend="#3760bf",
    ),
}

# ---------------------------------------------------------------------------------------
# The two files. Each line is a list of (text, color key, region tag or None).
# Region tags: c = comment, s = string or template literal, p = Markdown prose.
# ---------------------------------------------------------------------------------------
D = DASH
TS_LINES = [
    [("// Drafts expire " + D + " save often.", "comment", "c")],
    [("export const ", "purple", None), ("title", "fg", None), (" = ", "cyan", None),
     ("'Save " + D + " or lose it'", "green", "s"), (";", "cyan", None)],
    [("export const ", "purple", None), ("hint", "fg", None), (" = ", "cyan", None),
     ("`Retry " + D + " later`", "green", "s"), (";", "cyan", None)],
    [],
    [("export function ", "purple", None), ("parts", "blue", None), ("(", "cyan", None),
     ("s", "fg", None), (": ", "cyan", None), ("string", "cyan", None), (") {", "cyan", None)],
    [("  return ", "purple", None), ("s", "fg", None), (".", "cyan", None),
     ("split", "blue", None), ("(", "cyan", None), ("/\\s" + D + "\\s/", "orange", None),
     (");", "cyan", None)],
    [("}", "cyan", None)],
]
MD_LINES = [
    [("# ", "blue", None), ("Quick start", "blue", "p")],
    [],
    [("One config " + D + " every surface.", "fg", "p")],
    [("Fix with ", "fg", "p"), ("`charcheck " + D + "fix`", "green", None),
     (" later.", "fg", "p")],
    [("Read ", "fg", "p"), ("[", "muted", None), ("the guide", "cyan", "p"),
     ("](/docs/a" + D + "b)", "muted", None), (".", "fg", "p")],
    [],
    [("```sh", "muted", None)],
    [("echo \"kept " + D + " as is\"", "green", None)],
    [("```", "muted", None)],
]

# Phases: (scope name, set of region tags it reads, or "all"), plus the footer text.
TS_PHASES = [
    ("raw", "all", "reads the whole file"),
    ("comments", {"c"}, "reads comments, delimiters included"),
    ("strings", {"s"}, "reads string and template literals"),
]
MD_PHASES = [
    ("raw", "all", "reads the whole file"),
    ("markdown", {"p"}, "reads prose: no code, no link targets"),
    ("markdown", {"p"}, "reads prose: no code, no link targets"),
]

# ---------------------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------------------
W = 900
CODE_PX = 15
SMALL_PX = 13
PANEL_W = 440
GAP = W - 2 * PANEL_W
BAR_H = 42
PAD_X = 20
PAD_TOP = 18
LINE_H = 27
FOOT_H = 40
N_LINES = max(len(TS_LINES), len(MD_LINES))
BODY_H = PAD_TOP * 2 + N_LINES * LINE_H
PANEL_H = BAR_H + BODY_H + FOOT_H
LEGEND_Y = PANEL_H + 34
H = PANEL_H + 52

DURATION = 18  # seconds for the full loop
FADE = 0.5  # seconds per transition


class Glyphs:
    """Turns text into <use> references to one outlined path per distinct glyph and size."""

    def __init__(self, path):
        self.font = TTFont(path)
        self.gs = self.font.getGlyphSet()
        self.cmap = self.font.getBestCmap()
        self.upm = self.font["head"].unitsPerEm
        self.defs = {}

    def advance(self, px):
        return self.font["hmtx"]["space"][0] * px / self.upm

    def _id(self, ch, px):
        name = self.cmap.get(ord(ch))
        if name is None:
            sys.exit(f"font lacks U+{ord(ch):04X}")
        gid = f"g{px}-{name}".replace(".", "_")
        if gid not in self.defs:
            s = px / self.upm
            pen = SVGPathPen(self.gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
            self.gs[name].draw(TransformPen(pen, (s, 0, 0, -s, 0, 0)))
            self.defs[gid] = pen.getCommands()
        return gid

    def text(self, s, x, y, px):
        adv = self.advance(px)
        out = []
        for i, ch in enumerate(s):
            if ch == " ":
                continue
            gid = self._id(ch, px)
            if self.defs[gid]:
                out.append(f'<use href="#{gid}" x="{x + i * adv:.1f}" y="{y:.1f}"/>')
        return "".join(out)

    def defs_svg(self):
        return "".join(f'<path id="{k}" d="{v}"/>' for k, v in self.defs.items() if v)


def fmt(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


class Anim:
    """One CSS class per (kind, phase pattern). Resting value is the last phase's."""

    def __init__(self):
        self.rules = {}

    def cls(self, kind, pattern, lo, hi):
        key = f"{kind}{''.join('1' if p else '0' for p in pattern)}"
        if key not in self.rules:
            vals = [hi if p else lo for p in pattern]
            n = len(vals)
            f = FADE / DURATION * 100
            stops = [(0, vals[-1]), (f, vals[0])]
            for i in range(1, n):
                start = 100 * i / n
                stops += [(start, vals[i - 1]), (start + f, vals[i])]
            stops.append((100, vals[-1]))
            frames = " ".join(f"{fmt(p)}%{{opacity:{fmt(v)}}}" for p, v in stops)
            self.rules[key] = (
                f".{key}{{opacity:{fmt(vals[-1])};animation:{key} {DURATION}s linear infinite}}"
                f"@keyframes {key}{{{frames}}}"
            )
        return key

    def css(self):
        return "".join(self.rules.values())


def reads(phase, tag):
    _, what, _ = phase
    return what == "all" or (tag is not None and tag in what)


def panel(g, a, t, x0, name, lines, phases):
    out = []
    cw = g.advance(CODE_PX)
    sw = g.advance(SMALL_PX)
    y_body = BAR_H + PAD_TOP
    out.append(
        f'<rect x="{x0 + .5}" y=".5" width="{PANEL_W - 1}" height="{PANEL_H - 1}" rx="10" '
        f'fill="{t["panel"]}" stroke="{t["border"]}"/>'
    )
    out.append(
        f'<path d="M{x0 + .5} {BAR_H}V10.5a10 10 0 0 1 10-10h{PANEL_W - 21}a10 10 0 0 1 10 10'
        f'V{BAR_H}z" fill="{t["bar"]}"/>'
    )
    out.append(f'<g fill="{t["muted"]}">{g.text(name, x0 + PAD_X, 26, SMALL_PX)}</g>')

    # Scope pill, right aligned: "scope" then the name, one stacked name per phase.
    longest = max(len(p[0]) for p in phases)
    pill_w = (len("scope ") + longest) * sw + 22
    px = x0 + PANEL_W - PAD_X - pill_w
    out.append(
        f'<rect x="{px:.1f}" y="10" width="{pill_w:.1f}" height="23" rx="11.5" '
        f'fill="{t["tint"]}" fill-opacity="{t["tint_op"]}"/>'
    )
    out.append(f'<g fill="{t["muted"]}">{g.text("scope", px + 11, 26, SMALL_PX)}</g>')
    seen = []
    for name_ in dict.fromkeys(p[0] for p in phases):
        pattern = [p[0] == name_ for p in phases]
        c = a.cls("o", pattern, 0, 1)
        out.append(
            f'<g class="{c}" fill="{t["blue"]}">'
            f'{g.text(name_, px + 11 + 6 * sw, 26, SMALL_PX)}</g>'
        )
        seen.append(name_)

    # Highlight boxes. Raw reads whole lines; the other scopes read their regions.
    boxes = []
    for li, segs in enumerate(lines):
        y = y_body + li * LINE_H
        col = 0
        if segs:
            total = sum(len(s[0]) for s in segs)
            pattern = [p[1] == "all" for p in phases]
            if any(pattern):
                c = a.cls("o", pattern, 0, 1)
                boxes.append(
                    f'<rect class="{c}" x="{x0 + PAD_X - 4:.1f}" y="{y + 2}" '
                    f'width="{total * cw + 8:.1f}" height="{LINE_H - 4}" rx="4"/>'
                )
        for text, _, tag in segs:
            if tag is not None:
                pattern = [p[1] != "all" and reads(p, tag) for p in phases]
                if any(pattern):
                    c = a.cls("o", pattern, 0, 1)
                    boxes.append(
                        f'<rect class="{c}" x="{x0 + PAD_X + col * cw - 2:.1f}" y="{y + 2}" '
                        f'width="{len(text) * cw + 4:.1f}" height="{LINE_H - 4}" rx="4"/>'
                    )
            col += len(text)
    out.append(f'<g fill="{t["tint"]}" fill-opacity="{t["tint_op"]}">{"".join(boxes)}</g>')

    # Text, dimmed where the phase's scope does not read it, plus the flags on top.
    flags = []
    for li, segs in enumerate(lines):
        base = y_body + li * LINE_H + LINE_H / 2 + CODE_PX * 0.36
        col = 0
        for text, color, tag in segs:
            pattern = [reads(p, tag) for p in phases]
            c = a.cls("t", pattern, 0.3, 1)
            out.append(
                f'<g class="{c}" fill="{t[color]}">'
                f'{g.text(text, x0 + PAD_X + col * cw, base, CODE_PX)}</g>'
            )
            for i, ch in enumerate(text):
                if ch == DASH and any(pattern):
                    fc = a.cls("o", pattern, 0, 1)
                    fx = x0 + PAD_X + (col + i) * cw
                    fy = y_body + li * LINE_H
                    flags.append(
                        f'<g class="{fc}">'
                        f'<rect x="{fx - 1.5:.1f}" y="{fy + 3.5}" width="{cw + 3:.1f}" '
                        f'height="{LINE_H - 7}" rx="3" fill="{t["red"]}" fill-opacity="0.22" '
                        f'stroke="{t["red"]}" stroke-width="1.2"/>'
                        f'<g fill="{t["red"]}">{g.text(DASH, fx, base, CODE_PX)}</g></g>'
                    )
            col += len(text)
    out += flags

    # Footer: what the scope reads, and how many dashes it flags.
    fy = BAR_H + BODY_H
    out.append(
        f'<line x1="{x0 + 1}" x2="{x0 + PANEL_W - 1}" y1="{fy + .5}" y2="{fy + .5}" '
        f'stroke="{t["border"]}"/>'
    )
    texts = {}
    for i, p in enumerate(phases):
        n = sum(
            ch == DASH
            for segs in lines
            for text, _, tag in segs
            if reads(p, tag)
            for ch in text
        )
        texts.setdefault((p[2], n), []).append(i)
    for (desc, n), idx in texts.items():
        pattern = [i in idx for i in range(len(phases))]
        c = a.cls("o", pattern, 0, 1)
        count = f"{n} flagged"
        cx = x0 + PANEL_W - PAD_X - len(count) * sw
        out.append(
            f'<g class="{c}"><g fill="{t["muted"]}">{g.text(desc, x0 + PAD_X, fy + 25, SMALL_PX)}'
            f'</g><g fill="{t["red"]}">{g.text(count, cx, fy + 25, SMALL_PX)}</g></g>'
        )
    return "".join(out)


def legend(g, t):
    sw = g.advance(SMALL_PX)
    cw = g.advance(CODE_PX)
    items = []
    x = 0
    y = LEGEND_Y
    # read
    items.append(
        f'<rect x="{x}" y="{y - 13}" width="30" height="20" rx="4" fill="{t["tint"]}" '
        f'fill-opacity="{t["tint_op"] if t is THEMES["light"] else "0.24"}"/>'
        f'<g fill="{t["legend"]}">{g.text("read by the scope", x + 40, y + 2, SMALL_PX)}</g>'
    )
    x += 40 + len("read by the scope") * sw + 36
    items.append(
        f'<rect x="{x}" y="{y - 13}" width="{cw + 3:.1f}" height="20" rx="3" fill="{t["red"]}" '
        f'fill-opacity="0.22" stroke="{t["red"]}" stroke-width="1.2"/>'
        f'<g fill="{t["red"]}">{g.text(DASH, x + 1.5, y + 2.5, CODE_PX)}</g>'
        f'<g fill="{t["legend"]}">'
        f'{g.text("banned character it flags", x + cw + 13, y + 2, SMALL_PX)}</g>'
    )
    x += cw + 13 + len("banned character it flags") * sw + 36
    items.append(
        f'<g fill="{t["legend"]}" opacity="0.4">{g.text("abc", x, y + 2, SMALL_PX)}</g>'
        f'<g fill="{t["legend"]}">{g.text("skipped", x + 4 * sw, y + 2, SMALL_PX)}</g>'
    )
    x += (4 + len("skipped")) * sw
    return f'<g transform="translate({(W - x) / 2:.1f} 0)">{"".join(items)}</g>'


def build(g, theme):
    t = THEMES[theme]
    a = Anim()
    body = (
        panel(g, a, t, 0, "src/app.ts", TS_LINES, TS_PHASES)
        + panel(g, a, t, PANEL_W + GAP, "docs/guide.md", MD_LINES, MD_PHASES)
        + legend(g, t)
    )
    title = "Which part of a file each charcheck scope reads"
    desc = (
        "src/app.ts under the raw, comments and strings scopes, and docs/guide.md under raw "
        "and markdown. Each scope reads only its regions, and only em dashes inside them "
        "are flagged."
    )
    css = (
        a.css()
        + "@media (prefers-reduced-motion:reduce){*{animation:none!important}}"
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" role="img" aria-labelledby="t d">'
        f'<title id="t">{title}</title><desc id="d">{desc}</desc>'
        f"<style>{css}</style><defs>{g.defs_svg()}</defs>{body}</svg>\n"
    )


def main():
    font = next((p for p in FONT_CANDIDATES if os.path.exists(p)), None)
    if font is None:
        sys.exit("JetBrains Mono not found; edit FONT_CANDIDATES")
    for theme in THEMES:
        g = Glyphs(font)
        svg = build(g, theme)
        path = os.path.join(HERE, f"scopes-{theme}.svg")
        with open(path, "w", encoding="utf-8") as f:
            f.write(svg)
        print(f"{path} {len(svg.encode()) // 1024} KB")


if __name__ == "__main__":
    main()
