# Presets

Optional and outside core. Every preset is a function taking the targeting, because what to
ban is general but where to ban it never is.

```js
import { noAiPunctuation, invisibles } from '@shbernal/charcheck/presets';

export default {
  rules: [
    ...noAiPunctuation({ include: ['docs/**/*.md'] }),
    ...invisibles({ include: ['src/**/*.ts'], scope: 'strings', idPrefix: 'code' }),
  ],
};
```

Each returns an array of rules, so it spreads into `rules` alongside anything you wrote by
hand.

| Preset            | Covers                                                            |
| ----------------- | ----------------------------------------------------------------- |
| `noAiPunctuation` | Fancy dashes, smart quotes, the ellipsis character, exotic spaces |
| `invisibles`      | Zero-width characters and bidirectional controls                  |

`idPrefix` namespaces the generated rule ids, which is what lets the same preset be applied
twice with different targeting without an id collision.

## Core ships no vocabulary opinions and never will

There is no "delve" list, no "leverage" list. This tool is about characters. Word choice is
a different problem with different failure modes, and tools that do it well already exist;
see the prior art section of the [README](../README.md).
