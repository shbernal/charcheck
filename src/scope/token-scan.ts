/**
 * String and template literal ranges read from TypeScript's *scanner* rather than its
 * syntax tree.
 *
 * This exists for TypeScript 7, which no longer ships a parser that can be run in process:
 * `createSourceFile` moved out of the package and what is left is a token scanner. A
 * scanner is enough for this job, because every character this tool bans lives inside a
 * literal token, and a token is exactly what a scanner hands back.
 *
 * What a scanner does not have is the parser's context, and two decisions need it:
 *
 * - `/` opens a regular expression in some positions and divides in others. The walk below
 *   tracks enough state to decide, which is the standard lexer treatment.
 * - JSX text is only tokenized correctly by a scanner told it is inside an element, which
 *   needs the parser. `don't` in JSX text would otherwise open a string literal that runs
 *   to the next quote, so JSX is refused rather than mis-read. See `JsxUnsupportedError`.
 *
 * Getting the first one wrong is not a local error: a regular expression read as division
 * leaves the rest of its line tokenized as code, and a quote inside it opens a literal that
 * swallows real text. So the ambiguous positions are resolved rather than guessed at.
 */

/** The scanner methods this walk drives, described structurally so any major satisfies it. */
export interface TokenScanner {
  scan(): number;
  getTokenStart(): number;
  getTokenEnd(): number;
  reScanSlashToken(): number;
  reScanTemplateToken(isTaggedTemplate: boolean): number;
}

/**
 * The token kinds this walk names. Read from whichever `typescript` provided the scanner,
 * never hardcoded: the numbers are an implementation detail and have changed before.
 */
export interface TokenKinds {
  EndOfFileToken: number;
  StringLiteral: number;
  NoSubstitutionTemplateLiteral: number;
  TemplateHead: number;
  TemplateMiddle: number;
  TemplateTail: number;
  RegularExpressionLiteral: number;
  NumericLiteral: number;
  BigIntLiteral: number;
  Identifier: number;
  SlashToken: number;
  SlashEqualsToken: number;
  OpenParenToken: number;
  CloseParenToken: number;
  OpenBraceToken: number;
  CloseBraceToken: number;
  CloseBracketToken: number;
  PlusPlusToken: number;
  MinusMinusToken: number;
  EqualsGreaterThanToken: number;
  SemicolonToken: number;
  ColonToken: number;
  CommaToken: number;
  ExclamationToken: number;
  ClassKeyword: number;
  InterfaceKeyword: number;
  EnumKeyword: number;
  NamespaceKeyword: number;
  ModuleKeyword: number;
  TypeKeyword: number;
  ThisKeyword: number;
  SuperKeyword: number;
  TrueKeyword: number;
  FalseKeyword: number;
  NullKeyword: number;
  IfKeyword: number;
  WhileKeyword: number;
  ForKeyword: number;
  WithKeyword: number;
  ElseKeyword: number;
  DoKeyword: number;
  TryKeyword: number;
  FinallyKeyword: number;
}

export interface Range {
  start: number;
  end: number;
}

/**
 * Token kinds after which a `/` divides rather than opening a regular expression, because
 * they can end an expression. `)` and `}` are decided by the stacks below instead, since
 * both can end either an expression or a clause.
 */
function endsExpression(kinds: TokenKinds): Set<number> {
  return new Set([
    kinds.Identifier,
    kinds.NumericLiteral,
    kinds.BigIntLiteral,
    kinds.StringLiteral,
    kinds.NoSubstitutionTemplateLiteral,
    kinds.TemplateTail,
    kinds.RegularExpressionLiteral,
    kinds.CloseBracketToken,
    kinds.PlusPlusToken,
    kinds.MinusMinusToken,
    kinds.ThisKeyword,
    kinds.SuperKeyword,
    kinds.TrueKeyword,
    kinds.FalseKeyword,
    kinds.NullKeyword,
  ]);
}

/** The keywords whose parenthesized clause is a header, so a regular expression may follow it. */
function clauseHeads(kinds: TokenKinds): Set<number> {
  return new Set([kinds.IfKeyword, kinds.WhileKeyword, kinds.ForKeyword, kinds.WithKeyword]);
}

/**
 * The tokens a `{` can follow and still open a block rather than an object literal. A block
 * ends a statement, so a regular expression may follow its `}`; an object literal is a
 * value, so a `/` after its `}` divides.
 *
 * `)` is here because no `{` following a closing parenthesis is an object literal: every
 * one of them is a body, whether the clause was `if (…)` or `function f()`.
 */
function opensBlock(kinds: TokenKinds): Set<number> {
  return new Set([
    kinds.SemicolonToken,
    kinds.OpenBraceToken,
    kinds.CloseParenToken,
    kinds.EqualsGreaterThanToken,
    kinds.ElseKeyword,
    kinds.DoKeyword,
    kinds.TryKeyword,
    kinds.FinallyKeyword,
  ]);
}

/**
 * The keywords that introduce a declaration whose `{` opens a body rather than a value.
 * The previous token alone cannot tell them apart: `class C {` and `const c = {` both put a
 * `{` after an identifier or an `=`, and only the keyword earlier in the statement says
 * which. Their `}` ends a statement, so a regular expression may follow it.
 *
 * `type` is here for `type T = { … }`, where the braces are a type literal and not a value
 * however much they look like one.
 */
function opensBody(kinds: TokenKinds): Set<number> {
  return new Set([
    kinds.ClassKeyword,
    kinds.InterfaceKeyword,
    kinds.EnumKeyword,
    kinds.NamespaceKeyword,
    kinds.ModuleKeyword,
    kinds.TypeKeyword,
  ]);
}

/**
 * Tokens that end the reach of a pending declaration keyword.
 *
 * Every one of these names is also a legal property name, so `{ type: 1 }` and `{ class: 1 }`
 * scan the keyword rather than an identifier. A property name is followed by `:` or `,`, and
 * a declaration name never is, which separates the two cheaply.
 */
function endsHeader(kinds: TokenKinds): Set<number> {
  return new Set([kinds.SemicolonToken, kinds.ColonToken, kinds.CommaToken]);
}

/**
 * Every string and template literal range in `source`, in source order, as absolute offsets.
 *
 * `scanner` must already be positioned at the start of `source` with trivia skipped.
 */
export function literalRanges(scanner: TokenScanner, kinds: TokenKinds): Range[] {
  const literal = new Set([
    kinds.StringLiteral,
    kinds.NoSubstitutionTemplateLiteral,
    kinds.TemplateHead,
    kinds.TemplateMiddle,
    kinds.TemplateTail,
  ]);
  const expressionEnders = endsExpression(kinds);
  const heads = clauseHeads(kinds);
  const blockOpeners = opensBlock(kinds);
  const bodyKeywords = opensBody(kinds);
  const headerEnders = endsHeader(kinds);

  const ranges: Range[] = [];
  /** For each open `(`, whether it is a clause header. */
  const parens: boolean[] = [];
  /** For each open `{`, whether it opens a block. */
  const braces: boolean[] = [];
  /** The brace depth each unfinished `${` substitution was entered at. */
  const templates: number[] = [];

  let previous: number | undefined;
  /** Whether a `/` here would open a regular expression. */
  let regexAllowed = true;
  /** Whether a declaration keyword is still waiting for the `{` that opens its body. */
  let inHeader = false;

  for (;;) {
    let token = scanner.scan();
    if (token === kinds.EndOfFileToken) break;

    if (token === kinds.SlashToken || token === kinds.SlashEqualsToken) {
      if (regexAllowed) token = scanner.reScanSlashToken();
    } else if (token === kinds.ExclamationToken) {
      // Both the non-null assertion and logical not, and the two disagree about the `/`
      // after them: `a! / 2` divides, `!/re/.test(x)` does not. Which one this is, is
      // exactly what the token before it already decided, so leave that decision standing
      // rather than making a second one.
      previous = token;
      continue;
    } else if (token === kinds.OpenParenToken) {
      parens.push(previous !== undefined && heads.has(previous));
    } else if (token === kinds.CloseParenToken) {
      // A regular expression may follow the `)` of `if (…)`, but not the `)` of `f(…)`.
      regexAllowed = parens.pop() ?? false;
      previous = token;
      continue;
    } else if (token === kinds.OpenBraceToken) {
      braces.push(inHeader || previous === undefined || blockOpeners.has(previous));
      inHeader = false;
    } else if (token === kinds.CloseBraceToken) {
      if (templates.length > 0 && templates[templates.length - 1] === braces.length) {
        // The `}` that closes a `${…}`: the rest of the template is text, not code, and
        // only the scanner rerun reads it as such.
        templates.pop();
        token = scanner.reScanTemplateToken(false);
      } else {
        regexAllowed = braces.pop() ?? true;
        previous = token;
        continue;
      }
    }

    if (literal.has(token)) {
      const start = scanner.getTokenStart();
      const end = scanner.getTokenEnd();
      // Malformed source yields empty literals, and the two readers disagree about how
      // many. None of them can hold a banned character, so neither reader reports one.
      if (end > start) ranges.push({ start, end });
    }
    if (token === kinds.TemplateHead || token === kinds.TemplateMiddle)
      templates.push(braces.length);

    if (bodyKeywords.has(token)) inHeader = true;
    else if (headerEnders.has(token)) inHeader = false;

    regexAllowed = !expressionEnders.has(token);
    previous = token;
  }

  return ranges;
}
