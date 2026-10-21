# Hero footage

`hero-1920.mp4`, `hero-portrait.mp4`, `hero-poster.jpg` are all cut from one
clip: "Dynamic abstract shapes on the surface of a dark liquid", by Vlada
Karpovich, from Pexels.

    https://www.pexels.com/video/dynamic-abstract-shapes-on-the-surface-of-a-dark-liquid-16392051/

The Pexels licence is free for commercial use and requires no attribution
(https://www.pexels.com/license/). The credit is here anyway, because a file
whose provenance is written down is a file nobody has to re-litigate later.

Cut from the 2560x1440 original with ffmpeg: 12.5 seconds from t=1.0, audio
stripped, `yuv420p` so Safari will decode it, `+faststart` so playback begins
on the first bytes rather than the last.

    landscape   1920x1080  crf 30   1.7 MB
    portrait     720x1280  crf 31   0.8 MB   <= 767px only
    poster      1280x720   q 6       22 KB   painted before the video arrives

Re-cut, if the clip is ever replaced:

    ffmpeg -ss 1.0 -t 12.5 -i IN.mp4 -an \
      -vf "scale=1920:-2:flags=lanczos,format=yuv420p" \
      -c:v libx264 -profile:v high -preset slow -crf 30 -g 48 \
      -movflags +faststart hero-1920.mp4
