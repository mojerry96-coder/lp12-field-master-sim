# Blender sources

The scripts that produce the 3D assets this app loads. All of them run headless:

```bash
blender --background --python <script>.py
```

They write nothing to `src/` — each produces a `.blend` and, where relevant, a
`.glb` that is copied into `public/models/` by hand. That copy is deliberate:
an asset should change because someone decided it should, not because a build
step ran.

## What produces what

| Script | Produces |
| --- | --- |
| `build_lp12.py` | the master `.blend` every LP12 script opens — the pole shaft, the mount, the connector bank |
| `build_lp12_v2.py` | the LP12, its rig and the **eight** clips → `public/models/lp12_v2.glb`, plus `lp12_v2_assembled.glb` |
| `export_vehicles.py` | the per-vehicle GLBs and `vehicle_placements.json` |
| `build_lp12_studio.py` | the studio lighting scene and the camera anchors behind `public/models/camera_studio.json` |
| `regrade_textures.py` | non-destructive grade of the baked texture atlases |
| `render_coverage.py` | the coverage-dome reference renders |
| `build_awolowo_env.py` | the low-poly Awolowo Way environment |
| `export_awolowo_env.py` | that environment → `exports/awolowo_lowpoly_env.glb`, plus its two delivery renders |
| `make_hand_alpha.py` | cuts real alpha from the tutorial hand plates in `public/assets/lp12/` |

## Reproducibility, honestly

`build_awolowo_env.py` is self-contained: it builds the whole environment from
the plan constants at the top of the file, so the scene can be regenerated from
nothing. Change `ROAD_LEN`, `LANE`, the `SECONDARY` table or the palette and
rebuild.

The LP12 scripts are **not** self-contained. They read baked texture atlases
that live outside this repo and were produced by a bake pass that is not
scripted here. `build_lp12_v2.py` will abort rather than run without them —
`check_textures_graded()` fails loudly if the albedo island means come in below
target, which is what stops a silently under-graded model reaching the browser.
Treat `public/models/lp12_v2.glb` as the artefact of record for the antenna.

## The environment in the app

`exports/awolowo_lowpoly_env.glb` is the reference copy; the app loads the same
file from `public/models/`. `src/components/SiteEnvironment.jsx` mounts it in
the build canvas.

**The export merges geometry per collection before writing the GLB.** The scene
is authored as ~3,900 individual objects, which is the only sane way to lay a
city out parametrically, but every object is its own draw call and 3,900 of them
alongside the LP12 lost the WebGL context outright the first time it was loaded
in a browser. Merging takes it to 9 meshes — one per collection, split by the
exporter into one primitive per material — which is a ~435x cut in draw calls
and, as a side effect, took the file from 2.91 MB to 0.78 MB.

What that costs is per-object addressing: no picking one car out of the traffic.
Nothing in the simulation does that, the collection-level grouping the brief asks
for still works because the collections are still the nodes, and the `.blend`
keeps every object for editing.

The environment also has to keep out of the studio camera anchors.
`check_camera_sightlines()` fails the build if a secondary building contains or
occludes one, and `blocks_camera()` keeps trees, shrubs, lamps, bollards and
signals out of the corridor between the two wide anchors and the pole. Two of
the ten anchors — CAM_01 and CAM_09 — stand 30 and 33 m out from the median,
past the 20.2 m pavement edge and into the plots, so this is not hypothetical:
the first build put a building parapet 0.9 m in front of CAM_01 and the
simulation rendered a flat grey wall.

**The GLB is exported recentred on `LP12_INSTALL_ANCHOR`**, so it drops into the
scene at position zero with no rotation and the street builds itself around an
LP12 already standing at its own origin. The `.blend` keeps the site's own frame
— boulevard on y = 0, buildings at real coordinates — because that is what makes
the layout editable; only the export is rebased. Doing it here rather than in the
application avoids inverting a translation and a rotation across a Z-up to Y-up
conversion, which is the kind of sign error that puts the city a hundred metres
from the pole with nothing obviously wrong in the code.

It carries two named empties for the application to read:

- `LP12_INSTALL_ANCHOR` — planted in the central median, where background.png
  shows the twin-arm lighting column the LP12 is mounted on. The written brief
  said "on the pavement"; the photograph it points at does not, and the
  photograph is what the layout has to match.
- `NETWORK_DOME_ORIGIN` — 7.5 m above it, for centring the spherical coverage
  volume. Spherical, never a cone.

`build_awolowo_env.py` imports `lp12_v2.glb` into an `LP12_POLE` collection
standing at the anchor, so the .blend shows the whole picture. It is never
joined to anything, and `export_awolowo_env.py` strips it before writing the
GLB — the application loads that model itself, and shipping a second copy would
stand two poles in the same place.

The environment imports **`lp12_v2_assembled.glb`**, not the animated one.

An earlier version of this file claimed the animated GLB's rest pose was already
the assembled pose. It is not: the rest pose is the UNASSEMBLED start of the
task, with the antenna parked 0.62 m off its bracket waiting for ANIM_04. That
is correct for a training model and wrong for a backdrop.

Do not try to assemble the animated one after import. glTF bakes each node's
transform into the hierarchy, so an install rig's location in the imported file
is an absolute placement rather than the offset it was in the master — zeroing
them looks like it should work and instead puts the antenna at z 14.9, two
metres above the top of a 12.96 m pole. `build_lp12_v2.py` does the zeroing in
the master, where the rigs really are offsets, and exports the result.

Collections survive the export as parent nodes (`ENV_Roads`, `ENV_Buildings_Main`,
`ENV_Vegetation`, `ENV_Vehicles`, `ENV_StreetFurniture`, …), so groups can be
shown, hidden or highlighted independently.

## One hazard worth knowing

These scripts write `.blend` files that the Blender GUI may also have open. A
GUI save writes its own in-memory scene over whatever the CLI just built, and
it does so silently — `is_dirty` can read `False` while the two have already
diverged. Close the file in the GUI before rebuilding, or snapshot and revert
it first.

## Things that are not obvious

**`INCLUDE_VEHICLES = False`** in `build_awolowo_env.py`. Traffic is off by
request. The library, the `TRAFFIC` table and the placement code are all intact
— turning it back on is one line, and re-deriving 26 hand-placed positions from
nothing would not be.

**`site_look.json`** is written into `public/models/` by the environment build
and read by `src/components/SiteLighting.jsx`. It carries the view transform and
exposure, the world colour and strength, every light with its position, energy,
colour and aim vector, and every camera with lens, aperture and resolved focus
point. The application builds its own three.js scene and cannot read a `.blend`,
so anything not in that file gets re-guessed on the other side and drifts.

Note the tone-mapping entry. Blender's `Standard` is a linear transfer with an
exposure multiply, clipped at white — that is `THREE.LinearToneMapping`, not
`NoToneMapping`, which silently ignores `toneMappingExposure`.

**The cable flexes.** `Antenna_Cables` hangs off the tilt chain, so before this
the whole run — including the length cleated to the pole 1.2 m below the pivot —
swung rigidly with the antenna, ending 68 mm inside the shaft at full downtilt.
It now carries two morph targets, `Flex_Tilt_Neg` and `Flex_Tilt_Pos`, that
cancel the inherited rotation below the cleat. Anything setting
`Tilt_Rig.rotation.x` directly rather than playing ANIM_08 must drive those
weights too; the rule and the measured clearances are in `site_look.json` under
`lp12.cable_flex`.

**Two constants are duplicated across scripts** and have already caused silent
failures: the pole diameter (`build_lp12.py` builds `Pole_Shaft`, `build_lp12_v2.py`
has its own copy of the figure) and the downtilt range. Changing one and not the
other produces a build that runs cleanly and changes nothing.
