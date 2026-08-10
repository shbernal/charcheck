/**
 * charcheck, run against charcheck.
 *
 * The characters are built from their code points rather than written literally, for the
 * same reason the sources do it: a literal here would be a finding in the file that
 * defines the rule against it.
 */

const cp = (codePoint) => String.fromCodePoint(codePoint);

const DASHES = [cp(0x2014), cp(0x2015)];

const INVISIBLES = [
  cp(0x00ad), // soft hyphen
  cp(0x200b), // zero width space
  cp(0x200c), // zero width non-joiner
  cp(0x200d), // zero width joiner
  cp(0x200e), // left-to-right mark
  cp(0x200f), // right-to-left mark
  cp(0x2060), // word joiner
];

/** Written by hand, never by the tool. */
const GENERATED = ['dist/**', 'coverage/**', 'pnpm-lock.yaml'];

/** Fixtures hold literal banned characters on purpose; that is what they are for. */
const FIXTURES = ['tests/fixtures/**'];

export default {
  rules: [
    {
      id: 'no-em-dash-in-prose',
      chars: DASHES,
      message: 'Use a comma, a colon, or reword.',
      include: [
        'README.md',
        'AGENTS.md',
        'CHANGELOG.md',
        'CONTRIBUTING.md',
        'SECURITY.md',
        'docs/**/*.md',
      ],
    },
    {
      // Only text that can reach a reader. Comments in this repo are allowed dashes, and
      // this rule proves the scope does what the README claims.
      id: 'no-em-dash-in-rendered-text',
      chars: DASHES,
      scope: 'strings',
      message: 'Use a comma, a colon, or reword.',
      include: ['src/**/*.ts'],
    },
    {
      id: 'no-invisibles',
      chars: INVISIBLES,
      message: 'Invisible character. Delete it.',
      // The second pattern is not redundant: dotted directories are only scanned when a
      // pattern names them, so the workflows would otherwise go unchecked.
      include: ['**/*.{ts,js,md,json,yaml,yml}', '.github/**/*.yml'],
      exclude: [...GENERATED, ...FIXTURES],
    },
    {
      id: 'no-em-dash-in-commit-msg',
      chars: DASHES,
      message: 'Use a comma, a colon, or reword.',
      include: ['<commit-msg>'],
    },
  ],
  ignore: [...GENERATED, ...FIXTURES],
};
