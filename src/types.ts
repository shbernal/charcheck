/**
 * Public types. Frozen at the end of the core scanner work: changing any shape here is a
 * deliberate break, not a refactor.
 */

export type Severity = 'error' | 'warn';

/**
 * Which part of a file a rule looks at.
 *
 * - `raw` scans the whole file.
 * - `strings` scans string and template literals in TS/JS only, so comments and
 *   identifiers are exempt.
 * - `markup` scans the text a component file renders: template text, allowlisted
 *   attributes, interpolation expressions and script literals.
 * - `markdown` scans the prose of a document: not fenced or indented code, not inline code
 *   spans, not link targets.
 *
 * A closed union by decision, not by omission. See the settled design decisions in
 * `CONTRIBUTING.md`: a surface ships in core, and there is no registry a config can add to.
 */
export type Scope = 'raw' | 'strings' | 'markup' | 'markdown';

export interface FixContext {
  /** The enclosing literal for `strings` and `markup`, the enclosing sentence for `raw`. */
  container: string;
  match: string;
  /**
   * Where `match` starts inside `container`. Needed because a container may hold the same
   * text twice, and a fix that searched for it would answer for the wrong occurrence.
   */
  index: number;
  scope: Scope;
}

export type FixFunction = (ctx: FixContext) => string;

export interface Rule {
  id: string;
  /** Literal strings to ban. Escaped and joined into one alternation. */
  chars?: string[];
  /** Regex source, alternative to `chars`. Compiled with `gu`. */
  pattern?: string;
  message?: string;
  /**
   * Replacement, or a function for context-dependent fixes. Absence means the rule is not
   * autofixable. A JSON config can only use the string form.
   */
  fix?: string | FixFunction;
  /** Default `'error'`. */
  severity?: Severity;
  include: string[];
  exclude?: string[];
  /** Default `'raw'`. */
  scope?: Scope;
}

export interface Finding {
  ruleId: string;
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based, UTF-16 code units. */
  column: number;
  endColumn: number;
  /** Absolute offset into the file text, for fix application. */
  offset: number;
  match: string;
  message: string;
  severity: Severity;
  fixable: boolean;
  /**
   * What `applyFixes` writes over `match`. Present exactly when `fixable` is true.
   * Resolved during the scan, because a fix may be a function of its surrounding text and
   * the fixer is given only text and findings.
   */
  replacement?: string;
}

/** A region of the file that a rule's regex is allowed to match inside. */
export interface Chunk {
  /** Absolute offset into the original file text. */
  start: number;
  end: number;
  /**
   * What `FixContext.container` should be for matches in this chunk. `'self'` means the
   * chunk's own slice; `'sentence'` means the enclosing sentence, which is the unit a
   * prose fix has to decide from once the prose is hard-wrapped.
   */
  container: 'self' | 'sentence';
}

export interface ExtractorOptions {
  /** Attribute names whose static values and bound expressions count as rendered text. */
  textAttributes?: string[];
}

export type Extractor = (
  text: string,
  file: string,
  options?: ExtractorOptions,
) => Promise<Chunk[]>;
