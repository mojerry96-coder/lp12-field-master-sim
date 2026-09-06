# Gear click — source recording

`koiroylers-gear-click-351962.mp3` is the recording the simulation's one sound
effect is cut from. It is kept here rather than in `public/` because it is not
shipped: the file is a two-second ratchet RUN of about twenty-eight clicks at
72ms spacing, and playing it whole would give the same two-second burst
regardless of what triggered it.

`public/sfx/gear-click.wav` is one click taken out of it — the clean one at
0.641s, which has 73ms of silence in front and 79ms behind. `src/lib/sfx.js`
plays it on a tuning detent: one step of a slider or dial, one click.

It was also used for the installation, as a run of these clicks scheduled
across each assembly clip's exact duration so a part sounded like it was being
wound into place. That was removed — it measured correctly and did not sound
right on the assembly, which is not something measurement can settle. The
scheduling code is in the git history if a future install sound wants it.

To re-derive the asset:

    ffmpeg -v error -i koiroylers-gear-click-351962.mp3 -ac 1 -ar 44100 -f f32le - > /tmp/src.f32

then take samples from 0.6370s for 62ms, apply a 0.6ms fade-in and an 18ms
raised-cosine fade-out, and peak-normalise to -1 dBFS. The transient lands
3.5ms into the result — near enough to instant for a detent, which is played
the moment the step happens. Anything that schedules these clicks against a
clock rather than a gesture should subtract that 3.5ms, or every click will
sit consistently late.
