# Gear click — source recording

`koiroylers-gear-click-351962.mp3` is the recording the simulation's one sound
effect is cut from. It is kept here rather than in `public/` because it is not
shipped: the file is a two-second ratchet RUN of about twenty-eight clicks at
72ms spacing, and playing it whole would give the same two-second burst
regardless of what triggered it.

`public/sfx/gear-click.wav` is one click taken out of it — the clean one at
0.641s, which has 73ms of silence in front and 79ms behind. Runs of any length
are rebuilt from that single click by `src/lib/sfx.js`, which is what lets an
install ratchet be exactly as long as the animation clip it describes.

To re-derive the asset:

    ffmpeg -v error -i koiroylers-gear-click-351962.mp3 -ac 1 -ar 44100 -f f32le - > /tmp/src.f32

then take samples from 0.6370s for 62ms, apply a 0.6ms fade-in and an 18ms
raised-cosine fade-out, and peak-normalise to -1 dBFS. The transient must land
3.5ms into the result: `ATTACK_LEAD` in `src/lib/sfx.js` subtracts exactly that
so a click scheduled at T is *heard* at T.
