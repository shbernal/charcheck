// Generates terminal-light.svg and terminal-dark.svg, the animated README demo.
// Run from anywhere: `node assets/visuals/terminal/generate.mjs`. No dependencies.
//
// The output is the real CLI output of assets/demo/setup.sh, colored as the CLI colors it
// (path underlined, caret and "error" red, rule id and fixable hint dim, fix notice green).
// Banned characters never appear literally: the em dash is written as an XML entity and
// the zero width space is drawn as a visible marker cell.
//
// Every run of text is placed at its own computed x and pinned to its cell width with
// textLength, so columns (and the carets under them) line up whatever monospace font the
// viewer falls back to. Each command is a scene; scenes swap on a CSS keyframe timeline.
// The resting style of every element is the finished first scene, which is what a renderer
// without animation, or a reader with reduced motion, sees.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const THEMES = {
  dark: {
    bg: '#1a1b26',
    bar: '#16161e',
    border: '#2a2e42',
    fg: '#c0caf5',
    dim: '#565f89',
    red: '#f7768e',
    yellow: '#e0af68',
    green: '#9ece6a',
    prompt: '#7aa2f7',
  },
  light: {
    bg: '#e1e2e7',
    bar: '#d0d5e3',
    border: '#b8bdd0',
    fg: '#3760bf',
    dim: '#848cb5',
    red: '#f52a65',
    yellow: '#8c6c3e',
    green: '#587539',
    prompt: '#2e7de9',
  },
};

// Geometry.
const W = 960;
const FS = 16;
const ADV = 9.6; // cell width: 0.6em, the advance of nearly every monospace face
const LH = 24;
const BAR = 40;
const PAD_X = 28;
const TOP = BAR + 20;
const CYCLE = 24; // seconds
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

// Segment helpers. Each segment occupies `cells` columns.
const s = (t, c = 'fg') => ({ t, c, cells: t.length });
// A flagged em dash gets a red cell; one that is just file contents (the cat output) does not.
const DASH = { t: '&#x2014;', c: 'dash', cells: 1, ent: true };
const PLAIN_DASH = { t: '&#x2014;', c: 'fg', cells: 1, ent: true };
const ZW = { t: '', c: 'zw', cells: 1 };
const blank = () => ({ segs: [] });

// A finding block, exactly as the CLI prints it.
function finding(path, srcSegs, caretCol, rule, charLabel) {
  return [
    { segs: [s(path, 'path')] },
    { segs: [s('  '), ...srcSegs], hl: true },
    { segs: [s(' '.repeat(caretCol + 1)), s('^', 'red')] },
    {
      segs: [
        s('  '),
        s('error', 'red'),
        s('  '),
        s(rule, 'dim'),
        s(`  Banned character ${charLabel}`),
      ],
    },
  ];
}

const F_README_3 = () =>
  finding(
    'README.md:3:11',
    [s('One config'), DASH, s(' every surface.')],
    11,
    'no-em-dash-in-prose',
    'U+2014',
  );
const F_README_4 = () =>
  finding('README.md:4:15', [s('Nothing hidden'), ZW, s('here.')], 15, 'no-invisibles', 'U+200B');
const F_APP = () =>
  finding(
    'src/app.ts:2:28',
    [s("export const title = 'Save "), DASH, s(" or lose it';")],
    28,
    'no-em-dash-in-strings',
    'U+2014',
  );

// Scenes. A prompt line types `cmd` between t0 and t1 and runs at `enter`. Output lines
// carry the time they appear. The last prompt of a scene is idle with a blinking cursor.
const SCENES = [
  {
    start: 0,
    end: 9.6,
    items: [
      { prompt: 'cat src/app.ts', show: 0, t0: 0.5, t1: 1.5, enter: 1.9 },
      {
        at: 2.0,
        lines: [{ segs: [s('// Comments are exempt '), PLAIN_DASH, s(' this one stays.')] }],
      },
      {
        at: 2.0,
        lines: [{ segs: [s("export const title = 'Save "), PLAIN_DASH, s(" or lose it';")] }],
      },
      { prompt: 'charcheck', show: 2.0, t0: 2.6, t1: 3.2, enter: 3.6 },
      { at: 3.8, lines: [...F_README_3(), blank()] },
      { at: 3.95, lines: [...F_README_4(), blank()] },
      { at: 4.1, lines: [...F_APP(), blank()] },
      {
        at: 4.3,
        lines: [
          { segs: [s('3 errors, 0 warnings in 2 files'), s(' (1 fixable with --fix)', 'dim')] },
        ],
      },
      { idle: true, show: 4.35 },
    ],
  },
  {
    start: 9.9,
    end: 16.4,
    items: [
      { prompt: 'charcheck --fix --quiet', show: 9.9, t0: 10.3, t1: 11.7, enter: 12.0 },
      { at: 12.2, lines: [...F_README_4(), blank()] },
      { at: 12.35, lines: [...F_APP(), blank()] },
      {
        at: 12.55,
        lines: [
          { segs: [s('Fixed 1 finding. Read the diff: a fix is a guess about prose.', 'green')] },
          { segs: [s('2 errors, 0 warnings in 2 files')] },
        ],
      },
      { idle: true, show: 12.6 },
    ],
  },
  {
    start: 16.7,
    end: 23.6,
    items: [
      {
        prompt: 'charcheck --commit-msg .git/COMMIT_EDITMSG',
        show: 16.7,
        t0: 17.0,
        t1: 18.9,
        enter: 19.2,
      },
      {
        at: 19.4,
        lines: [
          ...finding(
            '.git/COMMIT_EDITMSG:1:14',
            [s('fix: tidy up '), DASH, s(' again')],
            14,
            'no-em-dash-in-commit-msg',
            'U+2014',
          ),
          blank(),
        ],
      },
      { at: 19.5, lines: [{ segs: [s('1 error, 0 warnings in 1 file')] }] },
      { idle: true, show: 19.55 },
    ],
  },
];

const FADE = 0.3;

const pct = (t) => `${+((t / CYCLE) * 100).toFixed(3)}%`;
const x = (col) => +(PAD_X + col * ADV).toFixed(2);
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function lineCount(scene) {
  let n = 0;
  for (const it of scene.items) n += it.lines ? it.lines.length : 1;
  return n;
}
const ROWS = Math.max(...SCENES.map(lineCount));
const H = TOP + ROWS * LH + 18;

function build(theme) {
  const css = [];
  const body = [];
  let anim = 0;
  const name = () => `k${anim++}`;

  // Opacity keyframes: hidden, then shown from `on` until `off` (or the end of the cycle).
  function appear(on, off = null, fade = 0.02) {
    const n = name();
    const kf = [
      `0%{opacity:0}`,
      `${pct(on)}{opacity:0}`,
      `${pct(Math.min(on + fade, CYCLE))}{opacity:1}`,
    ];
    if (off !== null)
      kf.push(`${pct(off)}{opacity:1}`, `${pct(off + 0.02)}{opacity:0}`, `100%{opacity:0}`);
    else kf.push(`100%{opacity:1}`);
    css.push(`@keyframes ${n}{${kf.join('')}}`);
    return n;
  }

  function textRun(seg, col, y) {
    const fill = {
      fg: theme.fg,
      path: theme.fg,
      dim: theme.dim,
      red: theme.red,
      green: theme.green,
      dash: theme.fg,
    }[seg.c];
    const out = [];
    const len = seg.cells;
    if (seg.c === 'dash') {
      out.push(
        `<rect x="${x(col)}" y="${y - FS + 1}" width="${ADV}" height="${FS + 5}" rx="2" fill="${theme.red}" fill-opacity=".28"/>`,
      );
    }
    if (seg.c === 'zw') {
      const cx = x(col);
      out.push(
        `<rect x="${cx + 1}" y="${y - FS + 1}" width="${ADV - 2}" height="${FS + 5}" rx="2" fill="${theme.red}" fill-opacity=".2" stroke="${theme.red}" stroke-width="1" stroke-dasharray="2 2"/>`,
        `<rect x="${+(cx + ADV / 2 - 0.75).toFixed(2)}" y="${y - FS + 4}" width="1.5" height="${FS - 1}" fill="${theme.red}"/>`,
      );
      return out.join('');
    }
    if (seg.t.trim() === '') return '';
    // Spaces are cells, not glyphs: move past them rather than rely on white-space:pre.
    if (!seg.ent && seg.t !== seg.t.trim()) {
      const lead = seg.t.length - seg.t.trimStart().length;
      const t = seg.t.trim();
      return textRun({ ...seg, t, cells: t.length }, col + lead, y);
    }
    const tl = len > 1 ? ` textLength="${+(len * ADV).toFixed(2)}" lengthAdjust="spacing"` : '';
    const text = seg.ent ? seg.t : esc(seg.t);
    // A single-cell glyph is centered on its cell so a narrower fallback still sits right.
    if (len === 1) {
      out.push(
        `<text x="${+(x(col) + ADV / 2).toFixed(2)}" y="${y}" fill="${fill}" text-anchor="middle">${text}</text>`,
      );
    } else {
      out.push(`<text x="${x(col)}" y="${y}" fill="${fill}"${tl}>${text}</text>`);
    }
    if (seg.c === 'path') {
      out.push(
        `<rect x="${x(col)}" y="${y + 3}" width="${+(len * ADV).toFixed(2)}" height="1.2" fill="${theme.fg}"/>`,
      );
    }
    return out.join('');
  }

  function renderLine(line, y, col = 0) {
    let out = '';
    for (const seg of line.segs) {
      out += textRun(seg, col, y);
      col += seg.cells;
    }
    return out;
  }

  const blinkName = 'blink';
  css.push(`@keyframes ${blinkName}{0%,50%{opacity:1}50.01%,100%{opacity:0}}`);
  css.push(`.b{animation:${blinkName} 1s step-end infinite}`);

  function cursorRect(cx, y) {
    return `<rect class="b" x="${cx}" y="${y - FS + 1}" width="${ADV}" height="${FS + 4}" fill="${theme.fg}" fill-opacity=".85"/>`;
  }

  SCENES.forEach((scene, si) => {
    const first = si === 0;
    const sn = name();
    const kf = [
      `0%{opacity:0}`,
      `${pct(scene.start)}{opacity:0}`,
      `${pct(scene.start + 0.2)}{opacity:1}`,
      `${pct(scene.end)}{opacity:1}`,
      `${pct(scene.end + FADE)}{opacity:0}`,
      `100%{opacity:0}`,
    ];
    css.push(`@keyframes ${sn}{${kf.join('')}}`);
    body.push(`<g opacity="${first ? 1 : 0}" style="animation:${sn} ${CYCLE}s linear infinite">`);

    let row = 0;
    for (const it of scene.items) {
      if (it.prompt !== undefined || it.idle) {
        const y = TOP + row * LH + FS;
        const parts = [];
        parts.push(
          `<text x="${+(x(0) + ADV / 2).toFixed(2)}" y="${y}" fill="${theme.prompt}" text-anchor="middle">$</text>`,
        );
        if (it.idle) {
          parts.push(cursorRect(x(2), y));
        } else {
          const n = it.prompt.length;
          const w = +(n * ADV).toFixed(2);
          parts.push(renderLine({ segs: [s(it.prompt)] }, y, 2));
          // Typing: a background cover with the cursor on its left edge steps right one
          // cell per character. At rest it sits past the command, uncovering it.
          const tn = name();
          const tkf = [
            `0%{transform:translateX(0)}`,
            `${pct(it.t0)}{transform:translateX(0);animation-timing-function:steps(${n},end)}`,
            `${pct(it.t1)}{transform:translateX(${w}px)}`,
            `100%{transform:translateX(${w}px)}`,
          ];
          css.push(`@keyframes ${tn}{${tkf.join('')}}`);
          const cvis = appear(it.show, it.enter, 0.01);
          parts.push(
            `<g transform="translate(${w} 0)" style="animation:${tn} ${CYCLE}s linear infinite">` +
              `<rect x="${x(2)}" y="${y - FS - 2}" width="${w + ADV + 2}" height="${LH}" fill="${theme.bg}"/>` +
              `<g opacity="0" style="animation:${cvis} ${CYCLE}s linear infinite">${cursorRect(x(2), y)}</g>` +
              `</g>`,
          );
        }
        const vis = appear(it.show, null, 0.01);
        // The idle prompt of the first scene is part of the resting frame; so is every line.
        body.push(`<g style="animation:${vis} ${CYCLE}s linear infinite">${parts.join('')}</g>`);
        row += 1;
        continue;
      }
      const vis = appear(it.at);
      const parts = it.lines.map((line, i) => renderLine(line, TOP + (row + i) * LH + FS));
      body.push(`<g style="animation:${vis} ${CYCLE}s linear infinite">${parts.join('')}</g>`);
      row += it.lines.length;
    }
    body.push(`</g>`);
  });

  css.push(`@media (prefers-reduced-motion:reduce){*{animation:none!important}}`);

  const dots = [theme.red, theme.yellow, theme.green]
    .map((c, i) => `<circle cx="${24 + i * 20}" cy="${BAR / 2}" r="6" fill="${c}"/>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">charcheck demo</title>
<desc id="d">A terminal runs cat src/app.ts, then charcheck, which reports three banned characters: an em dash in README prose, a zero width space in README, and an em dash in a TypeScript string. Then charcheck --fix --quiet fixes the prose em dash, and charcheck --commit-msg flags an em dash in a commit message.</desc>
<style>text{font-family:${FONT};font-size:${FS}px;white-space:pre}${css.join('')}</style>
<defs><clipPath id="w"><rect width="${W}" height="${H}" rx="10"/></clipPath></defs>
<g clip-path="url(#w)">
<rect width="${W}" height="${H}" fill="${theme.bg}"/>
<rect width="${W}" height="${BAR}" fill="${theme.bar}"/>
${dots}
<text x="${W / 2}" y="${BAR / 2 + 5}" fill="${theme.dim}" text-anchor="middle" style="font-size:13px">charcheck-demo</text>
${body.join('\n')}
</g>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="none" stroke="${theme.border}"/>
</svg>
`;
}

for (const [variant, theme] of Object.entries(THEMES)) {
  const file = join(here, `terminal-${variant}.svg`);
  writeFileSync(file, build(theme));
  console.log(`wrote ${file}`);
}
