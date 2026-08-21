# Field Master — LP12

A browser training simulator for installing and commissioning an **LP12 small-cell
antenna** on a roadside pole at Awolowo Way, Ikeja, Lagos.

The learner works through three scenes:

1. **Locate** — a looping aerial of the site. A pin marks the pole the LP12 goes on.
2. **Install** — the antenna is assembled on the pole a component at a time, then
   the mount height and downtilt are set and the resulting coverage is reviewed.
3. **Tune** — a handheld tablet, where the reporter's radio parameters are dialled
   in and a spherical coverage volume responds to every change.

Everything in the 3D scenes is a single glTF model exported from Blender, driven by
its own NLA-authored animation clips.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

```bash
npm run build      # production bundle into dist/
npm run preview    # serve that bundle
```

## How it fits together

| Path | What lives there |
| --- | --- |
| `src/App.jsx` | Scene shell — which mode is on screen, and the handovers between them |
| `src/store.js` | The single zustand store: mode, build progress, rig values, model state |
| `src/InstallationPage.jsx` | The install route's stage machine |
| `src/lib/installationStages.js` | The stage table — one row per step, driving camera, clip and copy |
| `src/lib/lp12AnimationController.js` | Plays one assembly clip to completion and holds its end pose |
| `src/components/` | 3D canvas, studio lighting, coverage dome, hotspot, background plate |
| `src/tuning/` | The tablet tuning scene, self-contained |
| `public/models/lp12_v2.glb` | The LP12 model and its six assembly clips |
| `blender/` | The headless Blender scripts that produce the 3D assets — see its own README |

### A few things that are load-bearing

**The GLB ships unassembled.** Every component sits at a rest offset until its clip
runs. Anything that wants the finished antenna has to snap all six clips to their end
pose first — and must *not* stop the actions afterwards, because stopping an action
restores its original values through the property bindings and springs the whole
thing back apart.

**The tuning tablet reuses the same model.** It clones the cached glTF's node graph
rather than loading a second copy: geometry, materials and textures are shared, and
nothing is re-downloaded.

**The tablet is a fixed artboard inside a photograph.** The UI is authored at
1366×1024 and clipped into the tablet's screen in the plate image, so the whole scene
scales as one unit. Anything that scales independently drifts out from behind the
bezel.

**Every readout on a tuning page is derived from that page's control.** Cards that
could only ever show one number were replaced by quantities the control genuinely
drives; each derivation still reproduces the approved figure exactly when the control
sits at target. See `src/tuning/tuning-config.js`.

## Accessibility

- Full keyboard operation, including the arc slider (arrows, Page Up/Down, Home/End).
- `prefers-reduced-motion` drops the background video to a still, holds the tutorial
  hand static, and disables the cursor parallax.
- Live regions announce each confirmed tuning value.
- The install route requires landscape; portrait shows a rotate prompt.

## Assets

The site photography, the tablet plate and the tutorial hand plates are project
assets and are not separately licensed for reuse.
