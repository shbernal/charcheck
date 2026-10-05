#!/usr/bin/env python3
"""Generate hooks-light.svg and hooks-dark.svg: one config driving every gate.

    python3 assets/visuals/hooks/generate.py

Needs fontTools and JetBrainsMono Nerd Font. All text is converted to outlines, so the
SVGs carry no font dependency. Banned characters are built from their code points: this
repo runs charcheck on itself.
"""

from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

OUT = Path(__file__).resolve().parent
FONTS = {
    "r": "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Regular.ttf",
    "b": "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Bold.ttf",
}
DASH = chr(0x2014)
SCISSORS = "# " + "-" * 24 + " >8 " + "-" * 24

W, H = 900, 358
T = 18.0  # loop length, seconds
R0, R1 = 17.2, 17.8  # fade back to the neutral state before the loop restarts

THEMES = {
    "dark": dict(
        card="#1a1b26", box="#16161e", edge="#3b4261", fg="#c0caf5", dim="#565f89",
        red="#f7768e", green="#9ece6a", blue="#7aa2f7", cyan="#7dcfff",
        purple="#bb9af7", yellow="#e0af68", hl=0.25,
    ),
    "light": dict(
        card="#e1e2e7", box="#d0d5e3", edge="#a8aecb", fg="#3760bf", dim="#848cb5",
        red="#f52a65", green="#587539", blue="#2e7de9", cyan="#007197",
        purple="#9854f1", yellow="#8c6c3e", hl=0.4,
    ),
}


class Outliner:
    """Turns text into <use> references to glyph outlines collected in <defs>."""

    def __init__(self):
        self.fonts = {k: TTFont(p) for k, p in FONTS.items()}
        self.upm = self.fonts["r"]["head"].unitsPerEm
        self.adv = self.fonts["r"]["hmtx"]["A"][0]
        self.defs = {}

    def glyph(self, face, ch):
        key = f"{face}{ord(ch):x}"
        if key not in self.defs:
            font = self.fonts[face]
            gs = font.getGlyphSet()
            pen = SVGPathPen(gs)
            gs[font.getBestCmap()[ord(ch)]].draw(pen)
            self.defs[key] = pen.getCommands()
        return key

    def width(self, s, size):
        return len(s) * self.adv / self.upm * size

    def text(self, x, y, s, size, fill, face="r", anchor="start", attrs=""):
        if anchor == "end":
            x -= self.width(s, size)
        k = size / self.upm
        uses = "".join(
            f'<use href="#{self.glyph(face, ch)}" x="{i * self.adv}"/>'
            for i, ch in enumerate(s)
            if ch != " "
        )
        return (
            f'<g fill="{fill}" transform="translate({x:.2f} {y:.2f}) scale({k:.5f} {-k:.5f})"'
            f"{attrs}>{uses}</g>"
        )

    def defs_svg(self):
        return "".join(f'<path id="{k}" d="{d}"/>' for k, d in sorted(self.defs.items()))


class Timeline:
    """Keyframes over one loop. Each element's attributes hold its final frame."""

    def __init__(self):
        self.rules = []
        self.n = 0

    def add(self, stops):
        """stops: list of (seconds, {property: value}). Returns a class attribute."""
        self.n += 1
        name = f"k{self.n}"
        frames = "".join(
            f"{t / T * 100:.2f}%{{{';'.join(f'{p}:{v}' for p, v in props.items())}}}"
            for t, props in stops
        )
        self.rules.append(f"@keyframes {name}{{{frames}}}.{name}{{animation:{name} {T:g}s linear infinite}}")
        return f' class="{name}"'

    def css(self):
        return "".join(self.rules)


def phase(s, before, red, green, *, red_at=1.6, green_at=3.2, ramp=0.15):
    """Neutral, then red at s+red_at, then green at s+green_at, then neutral again."""
    stops = [(0, before), (s + red_at, before)]
    if red is not None:
        stops += [(s + red_at + ramp, red), (s + green_at, red)]
    else:
        stops.append((s + green_at, before))
    stops += [(s + green_at + ramp, green), (R0, green), (R1, before), (T, before)]
    return stops


def build(theme):
    c = THEMES[theme]
    o = Outliner()
    tl = Timeline()
    parts = []
    add = parts.append

    add(f'<rect width="{W}" height="{H}" rx="12" fill="{c["card"]}"/>')

    # The config node.
    cfg_y, cfg_h = H / 2 - 32, 64
    cfg_cy = H / 2
    add(f'<rect x="16" y="{cfg_y}" width="176" height="{cfg_h}" rx="8" fill="{c["box"]}" stroke="{c["purple"]}" stroke-width="1.5"/>')
    add(o.text(30, cfg_cy - 4, "charcheck.config.js", 12.5, c["fg"], "b"))
    add(o.text(30, cfg_cy + 15, "rules: [ ... ]", 11, c["dim"]))

    gx, gw = 236, 430
    spine = 214
    lanes = [
        dict(y=16, h=70, start=0.6),
        dict(y=104, h=90, start=4.8),
        dict(y=212, h=130, start=9.0),
    ]
    for ln in lanes:
        ln["cy"] = ln["y"] + ln["h"] / 2

    # Connectors, drawn under everything else.
    for ln in lanes:
        cy = ln["cy"]
        if abs(cy - cfg_cy) < 1:
            d = f"M192 {cfg_cy}H{gx}"
        else:
            sgn = 1 if cy > cfg_cy else -1
            d = (
                f"M192 {cfg_cy}H{spine - 8}Q{spine} {cfg_cy} {spine} {cfg_cy + 8 * sgn}"
                f"V{cy - 8 * sgn}Q{spine} {cy} {spine + 8} {cy}H{gx}"
            )
        add(f'<path d="{d}" fill="none" stroke="{c["edge"]}" stroke-width="1.5"/>')

    def gate(ln, label, command, reads):
        y, h, s = ln["y"], ln["h"], ln["start"]
        stroke = tl.add(phase(s, {"stroke": c["edge"]}, {"stroke": c["red"]}, {"stroke": c["green"]}))
        add(f'<rect x="{gx}" y="{y}" width="{gw}" height="{h}" rx="8" fill="{c["box"]}" stroke="{c["green"]}" stroke-width="1.5"{stroke}/>')
        add(o.text(gx + 14, y + 18, label, 10.5, c["dim"]))
        add(o.text(gx + 14, y + 37, command, 13, c["fg"], "b"))
        right = gx + gw - 14
        add(o.text(right, y + 18, reads, 10.5, c["cyan"], anchor="end"))
        add(o.text(right - o.width(reads + " ", 10.5), y + 18, "reads", 10.5, c["dim"], anchor="end"))

        # The scan bar sweeping the gate once the packet arrives.
        t0, t1 = s + 0.9, s + 1.6
        scan = tl.add([
            (0, {"opacity": 0, "transform": "translateX(0px)"}),
            (t0, {"opacity": 0, "transform": "translateX(0px)"}),
            (t0 + 0.05, {"opacity": 0.8, "transform": "translateX(4px)"}),
            (t1, {"opacity": 0.8, "transform": f"translateX({gw - 6}px)"}),
            (t1 + 0.05, {"opacity": 0, "transform": f"translateX({gw - 6}px)"}),
            (T, {"opacity": 0, "transform": "translateX(0px)"}),
        ])
        add(f'<rect x="{gx}" y="{y + 4}" width="2" height="{h - 8}" fill="{c["purple"]}" opacity="0"{scan}/>')

        # The packet travelling from the config to this gate.
        pts = [(192, cfg_cy), (spine, cfg_cy), (spine, ln["cy"]), (gx, ln["cy"])]
        lens = [abs(b[0] - a[0]) + abs(b[1] - a[1]) for a, b in zip(pts, pts[1:])]
        total = sum(lens)
        stops = [(0, {"opacity": 0, "transform": f"translate({pts[0][0]}px,{pts[0][1]}px)"})]
        t = s
        stops.append((t, {"opacity": 1, "transform": f"translate({pts[0][0]}px,{pts[0][1]}px)"}))
        for p, seg in zip(pts[1:], lens):
            t += 0.9 * seg / total
            stops.append((t, {"opacity": 1, "transform": f"translate({p[0]}px,{p[1]}px)"}))
        stops.append((t + 0.05, {"opacity": 0, "transform": f"translate({pts[-1][0]}px,{pts[-1][1]}px)"}))
        stops.append((T, {"opacity": 0, "transform": f"translate({pts[0][0]}px,{pts[0][1]}px)"}))
        packet = tl.add(stops)
        add(f'<circle r="5" fill="{c["purple"]}" opacity="0" transform="translate({pts[-1][0]} {pts[-1][1]})"{packet}/>')

    def outcome(ln, found, fixed):
        cy, s = ln["cy"], ln["start"]
        ix, iy = 698, cy - 10
        # Neutral ring.
        a = tl.add(phase(s, {"opacity": 1}, {"opacity": 0}, {"opacity": 0}))
        add(f'<circle cx="{ix}" cy="{iy}" r="9.5" fill="none" stroke="{c["edge"]}" stroke-width="1.5" opacity="0"{a}/>')
        # Red: a cross and exit 1.
        a = tl.add(phase(s, {"opacity": 0}, {"opacity": 1}, {"opacity": 0}))
        add(
            f'<g opacity="0"{a}><circle cx="{ix}" cy="{iy}" r="10" fill="{c["red"]}"/>'
            f'<path d="M{ix - 4} {iy - 4}l8 8m0 -8l-8 8" stroke="{c["box"]}" stroke-width="2.2" stroke-linecap="round"/>'
            + o.text(716, cy - 5, "exit 1", 13, c["red"], "b") + "</g>"
        )
        # Green: a check and exit 0.
        a = tl.add(phase(s, {"opacity": 0}, {"opacity": 0}, {"opacity": 1}))
        add(
            f'<g{a}><circle cx="{ix}" cy="{iy}" r="10" fill="{c["green"]}"/>'
            f'<path d="M{ix - 4.5} {iy + 0.5}l3 3l6 -7" fill="none" stroke="{c["box"]}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
            + o.text(716, cy - 5, "exit 0", 13, c["green"], "b") + "</g>"
        )
        # What was found stays on screen, red while failing, dim once fixed.
        a = tl.add(phase(s, {"opacity": 0, "fill": c["red"]}, {"opacity": 1, "fill": c["red"]}, {"opacity": 1, "fill": c["dim"]}))
        add(o.text(686, cy + 14, found, 10.5, c["dim"], attrs=a))
        a = tl.add(phase(s, {"opacity": 0}, {"opacity": 0}, {"opacity": 1}))
        add(o.text(686, cy + 29, fixed, 10.5, c["fg"], attrs=a))

    def swap(ln, x, y, size, old, new, color):
        """The banned character, highlighted red, then its replacement highlighted green."""
        s = ln["start"]
        cw = o.width("x", size)
        hl = tl.add(phase(s, {"opacity": 0, "fill": c["red"]}, {"opacity": 0.28, "fill": c["red"]}, {"opacity": c["hl"], "fill": c["green"]}, green_at=3.0))
        add(f'<rect x="{x - 1:.2f}" y="{y - size:.2f}" width="{cw + 2:.2f}" height="{size + 4:.2f}" rx="2" fill="{c["green"]}" opacity="{c["hl"]}"{hl}/>')
        a = tl.add(phase(s, {"opacity": 1}, None, {"opacity": 0}, green_at=3.0))
        add(o.text(x, y, old, size, color, attrs=' opacity="0"' + a))
        a = tl.add(phase(s, {"opacity": 0}, None, {"opacity": 1}, green_at=3.0))
        add(o.text(x, y, new, size, color, attrs=a))

    def appear(ln):
        return tl.add(phase(ln["start"], {"opacity": 0}, {"opacity": 1}, {"opacity": 1}))

    tx = gx + 14
    rs, ds = 11.5, 10.5  # row sizes: content, dimmed context
    ch = o.width("x", rs)

    # Lane 1: the package script reads the working tree.
    l1 = lanes[0]
    gate(l1, "package script", "pnpm run lint:chars", "working tree")
    y = l1["y"] + 58
    add(o.text(tx, y, "README.md", rs, c["dim"]))
    pre, post = "One config", " every surface."
    x0 = tx + 11 * ch
    add(o.text(x0, y, pre, rs, c["fg"]))
    swap(l1, x0 + len(pre) * ch, y, rs, DASH, ",", c["fg"])
    add(o.text(x0 + (len(pre) + 1) * ch, y, post, rs, c["fg"]))
    outcome(l1, "U+2014 at 3:11", "fixed with --fix")

    # Lane 2: pre-commit reads the index, so the unstaged edit is never read.
    l2 = lanes[1]
    gate(l2, "pre-commit hook", "charcheck --staged", "git index")
    y = l2["y"] + 58
    add(o.text(tx, y, "staged", rs, c["green"]))
    add(o.text(tx + 10 * ch, y, "docs/setup.md", rs, c["dim"]))
    pre, post = "One step", " then done."
    x0 = tx + 25 * ch
    add(o.text(x0, y, pre, rs, c["fg"]))
    swap(l2, x0 + len(pre) * ch, y, rs, DASH, ",", c["fg"])
    add(o.text(x0 + (len(pre) + 1) * ch, y, post, rs, c["fg"]))
    y += 19
    add(o.text(tx, y, "unstaged", rs, c["dim"]))
    add(o.text(tx + 10 * ch, y, "docs/draft.md", rs, c["dim"]))
    add(o.text(tx + 25 * ch, y, f"Still a draft{DASH} later.", rs, c["dim"]))
    add(o.text(gx + gw - 14, y, "ignored", ds, c["dim"], anchor="end", attrs=appear(l2)))
    outcome(l2, "U+2014, staged copy", "--fix restages it")

    # Lane 3: commit-msg reads the message, skipping comments and the scissors.
    l3 = lanes[2]
    gate(l3, "commit-msg hook", 'charcheck --commit-msg "$1"', "message file")
    y = l3["y"] + 58
    s = l3["start"]
    hl = tl.add(phase(s, {"opacity": 0, "fill": c["red"]}, {"opacity": 0.28, "fill": c["red"]}, {"opacity": 0, "fill": c["red"]}, green_at=3.0))
    add(f'<rect x="{tx + 13 * ch - 1:.2f}" y="{y - rs:.2f}" width="{ch + 2:.2f}" height="{rs + 4:.2f}" rx="2" fill="{c["green"]}" opacity="0"{hl}/>')
    a = tl.add(phase(s, {"opacity": 1}, None, {"opacity": 0}, green_at=3.0))
    add(o.text(tx, y, f"fix: tidy up {DASH} again", rs, c["fg"], attrs=' opacity="0"' + a))
    a = tl.add(phase(s, {"opacity": 0}, None, {"opacity": 1}, green_at=3.0))
    add(o.text(tx, y, "fix: tidy up again", rs, c["fg"], attrs=a))
    rows = ["# Please enter the commit message for your changes.", SCISSORS, f"+One config{DASH} every surface."]
    for i, row in enumerate(rows):
        add(o.text(tx, y + 19 * (i + 1), row, ds, c["dim"]))
    bx = tx + o.width(SCISSORS, ds) + 10
    top, bot = y + 19 - ds - 1, y + 19 * 3 + 3
    a = appear(l3)
    add(
        f'<g{a}><path d="M{bx} {top}h4V{bot}h-4" fill="none" stroke="{c["dim"]}" stroke-width="1.2"/>'
        + o.text(bx + 9, (top + bot) / 2 + 4, "skipped", ds, c["dim"]) + "</g>"
    )
    outcome(l3, "U+2014 at 1:14", "reworded by hand")

    title = (
        "One charcheck.config.js drives three gates: pnpm run lint:chars reads the working "
        "tree, charcheck --staged reads the git index and ignores an unstaged edit, and "
        f"charcheck --commit-msg catches &#x2014; in a message while skipping comments and "
        "everything below the scissors line."
    )
    css = tl.css() + "@media (prefers-reduced-motion:reduce){*{animation:none!important}}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="{title}">'
        f"<title>{title}</title><style>{css}</style><defs>{o.defs_svg()}</defs>"
        + "".join(parts)
        + "</svg>\n"
    )


def main():
    for theme in THEMES:
        svg = build(theme)
        assert DASH not in svg and chr(0x200B) not in svg
        path = OUT / f"hooks-{theme}.svg"
        path.write_text(svg, encoding="utf-8")
        print(f"{path.name}: {len(svg.encode()) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
