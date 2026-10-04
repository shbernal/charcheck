#!/bin/sh
# Renders demo.gif from demo.tape. VHS records the frames; ffmpeg and gifski do the encode,
# since VHS's own encoder exits without output under ffmpeg 9. Run from the repo root after
# `pnpm run build`. Needs vhs, ffmpeg and gifski.
set -e
root=$(pwd)
work=$(mktemp -d)
sed "s|assets/demo/setup.sh|$root/assets/demo/setup.sh|" assets/demo/demo.tape > "$work/demo.tape"
(cd "$work" && vhs demo.tape)
mkdir "$work/out"
size=$(ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=s=x:p=0 "$work/frames/frame-text-00001.png")
ffmpeg -loglevel error -framerate 20 -i "$work/frames/frame-text-%05d.png" -framerate 20 -i "$work/frames/frame-cursor-%05d.png" \
  -filter_complex "color=0x16161e:s=$size:r=20[bg];[bg][0]overlay=shortest=1[t];[t][1]overlay,pad=iw+56:ih+40:28:20:color=0x16161e" \
  "$work/out/%05d.png"
gifski --quiet --fps 20 -o assets/demo/demo.gif "$work"/out/*.png
rm -rf "$work"
