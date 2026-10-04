# Records the README demo. From the repo root, after `pnpm run build`:
#   sh assets/demo/render.sh

Output frames/

Set Shell bash
Set Theme "TokyoNight"
Set FontSize 18
Set Width 1200
Set Height 680
Set Framerate 20
Set TypingSpeed 45ms

Hide
Type "sh assets/demo/setup.sh && cd /tmp/charcheck-demo && export PATH=/tmp/charcheck-demo-bin:$PATH PS1='$ ' INPUTRC=/dev/null && bind 'set show-mode-in-prompt off' && clear"
Enter
Sleep 1s
Show

Type "cat src/app.ts"
Sleep 300ms
Enter
Sleep 2s

Type "charcheck"
Sleep 400ms
Enter
Sleep 4s

Type "clear && charcheck --fix --quiet"
Sleep 400ms
Enter
Sleep 4s

Type "clear && charcheck --commit-msg .git/COMMIT_EDITMSG"
Sleep 400ms
Enter
Sleep 4s
