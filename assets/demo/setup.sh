#!/bin/sh
# Builds the throwaway repo that demo.tape records. Banned characters are written as printf
# escapes so this file never holds one itself. Run `pnpm run build` first.
set -e
dir=/tmp/charcheck-demo
cli=$(cd "$(dirname "$0")/../.." && pwd)/dist/cli.js
rm -rf "$dir" "$dir-bin" && mkdir -p "$dir/src" "$dir-bin" && cd "$dir"
printf '#!/bin/sh\nexec node %s "$@"\n' "$cli" > "$dir-bin/charcheck" && chmod +x "$dir-bin/charcheck"
dash=$(printf '\342\200\224')
zwsp=$(printf '\342\200\213')

cat > charcheck.config.js <<'CFG'
const DASH = '\u2014';

export default {
  rules: [
    { id: 'no-em-dash-in-prose', chars: [DASH], fix: ',', include: ['*.md'] },
    { id: 'no-em-dash-in-strings', chars: [DASH], scope: 'strings', include: ['src/**/*.ts'] },
    { id: 'no-em-dash-in-commit-msg', chars: [DASH], include: ['<commit-msg>'] },
    { id: 'no-invisibles', chars: ['\u200b'], include: ['**/*.{md,ts}'] },
  ],
};
CFG

printf '# Demo\n\nOne config%s every surface.\nNothing hidden%shere.\n' "$dash" "$zwsp" > README.md
printf "// Comments are exempt %s this one stays.\nexport const title = 'Save %s or lose it';\n" "$dash" "$dash" > src/app.ts
git init -q && git add README.md src
printf 'fix: tidy up %s again\n' "$dash" > .git/COMMIT_EDITMSG
