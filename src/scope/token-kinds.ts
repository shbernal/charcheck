/**
 * The token kinds `literalRanges` names, resolved out of a `SyntaxKind` enum at load time.
 *
 * Resolved rather than hardcoded for two reasons, both measured against TypeScript 7 rather
 * than guessed at: the numeric values are entirely different between majors, and at least
 * one name changed (`EndOfFileToken` became `EndOfFile`). A missing name is therefore a
 * real possibility on a future release, and it must not be allowed to read as `undefined` —
 * a walk comparing tokens against `undefined` finds nothing, and finding nothing is exactly
 * what a passing scan looks like.
 */

import type { TokenKinds } from './token-scan.js';

export class UnknownTokenKindError extends Error {
  constructor(names: readonly string[]) {
    super(
      `This TypeScript's SyntaxKind has no ${names.map((name) => `"${name}"`).join(' or ')}. ` +
        `charcheck cannot scan with it. Please report this with the TypeScript version.`,
    );
    this.name = 'UnknownTokenKindError';
  }
}

type SyntaxKindEnum = Record<string, unknown>;

function kind(syntaxKind: SyntaxKindEnum, ...names: string[]): number {
  for (const name of names) {
    const value = syntaxKind[name];
    if (typeof value === 'number') return value;
  }
  throw new UnknownTokenKindError(names);
}

export function resolveTokenKinds(syntaxKind: SyntaxKindEnum): TokenKinds {
  const at = (...names: string[]): number => kind(syntaxKind, ...names);
  return {
    // TypeScript 7 dropped the `Token` suffix here and nowhere else that matters.
    EndOfFileToken: at('EndOfFile', 'EndOfFileToken'),
    StringLiteral: at('StringLiteral'),
    NoSubstitutionTemplateLiteral: at('NoSubstitutionTemplateLiteral'),
    TemplateHead: at('TemplateHead'),
    TemplateMiddle: at('TemplateMiddle'),
    TemplateTail: at('TemplateTail'),
    RegularExpressionLiteral: at('RegularExpressionLiteral'),
    NumericLiteral: at('NumericLiteral'),
    BigIntLiteral: at('BigIntLiteral'),
    Identifier: at('Identifier'),
    SlashToken: at('SlashToken'),
    SlashEqualsToken: at('SlashEqualsToken'),
    OpenParenToken: at('OpenParenToken'),
    CloseParenToken: at('CloseParenToken'),
    OpenBraceToken: at('OpenBraceToken'),
    CloseBraceToken: at('CloseBraceToken'),
    CloseBracketToken: at('CloseBracketToken'),
    PlusPlusToken: at('PlusPlusToken'),
    MinusMinusToken: at('MinusMinusToken'),
    EqualsGreaterThanToken: at('EqualsGreaterThanToken'),
    SemicolonToken: at('SemicolonToken'),
    ThisKeyword: at('ThisKeyword'),
    SuperKeyword: at('SuperKeyword'),
    TrueKeyword: at('TrueKeyword'),
    FalseKeyword: at('FalseKeyword'),
    NullKeyword: at('NullKeyword'),
    IfKeyword: at('IfKeyword'),
    WhileKeyword: at('WhileKeyword'),
    ForKeyword: at('ForKeyword'),
    WithKeyword: at('WithKeyword'),
    ElseKeyword: at('ElseKeyword'),
    DoKeyword: at('DoKeyword'),
    TryKeyword: at('TryKeyword'),
    FinallyKeyword: at('FinallyKeyword'),
  };
}
