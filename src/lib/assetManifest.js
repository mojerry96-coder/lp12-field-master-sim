/**
 * The one authoritative list of what this simulation loads.
 *
 * Every asset path lives here and nowhere else. Two pages requesting the same
 * file through different URLs is the failure this exists to prevent: the
 * browser treats them as different resources, downloads and decodes both, and
 * the loader cache never hits.
 *
 * Priorities map to when an asset is fetched, not how important it is:
 *
 *   P1  during the opener — nothing may be visible until these are ready
 *   P2  in the background once the isometric scene is interactive, so the
 *       studio is already built when the hotspot is clicked
 *   P3  in the background during the physical install, so the tablet opens as
 *       a finished composition
 *
 * A note on names. The tuning scene's two plates were supplied as
 * `street-background.png` and `tablet-hand-foreground.png`, and ship as WebP
 * under those names; `byBriefName` below still resolves the brief's spelling.
 * The earlier `street-plate.jpg` and `tablet-cutout.webp` — the same two
 * layers cut out of the original composite — remain on disk unreferenced,
 * because the aperture in `tuning-config.js` is measured on the new plate and
 * the old cutout does not register against it.
 */

export const P1 = 'p1'
export const P2 = 'p2'
export const P3 = 'p3'

/** How a file has to be fetched to count as "ready". */
export const KIND = {
  gltf: 'gltf',       // parsed and its shaders compilable
  image: 'image',     // decoded, not merely downloaded
  json: 'json',
  font: 'font',
}

/**
 * `bytes` is the measured size on disk, used to weight the progress bar.
 * Counting files instead makes a 6 KB JSON worth as much as a 1.5 MB GLB, and
 * the bar then sits at 90% for the entire wait.
 */
export const ASSETS = [
  /* ---- P1: the opener and the first scene ------------------------------ */
  { id: 'iso-background', url: '/city-isometric.webp', kind: KIND.image, priority: P1, bytes: 226_000,
    note: 'Isometric environment background, rendered from CAM_ENV_ISOMETRIC' },
  { id: 'site-look', url: '/models/site_look.json', kind: KIND.json, priority: P1, bytes: 6_000,
    note: 'Blender look manifest: transform, world, lights, cameras' },
  // Page 01's hero panel. The redesign's own reference code points at a
  // `pole-hero.png` the handoff never shipped; this is that image, cut from
  // the supplied 01-welcome reference render at the panel's own crop.
  { id: 'welcome-hero', url: '/assets/lp12/welcome-hero.webp', kind: KIND.image, priority: P1,
    bytes: 54_000, note: 'LP12 on the pole, the sharp subject on Page 01' },
  // Generated to the replication kit's own prompt for `landing-awolowo-bg`:
  // one frame carrying the boulevard in perspective with the LP12 sharp in the
  // right foreground, and the left 38% held calm for the title. It replaces
  // Page 01's two-layer stand-in, which composited the isometric render under a
  // cut-out hero and showed the cut-out's edge.
  { id: 'landing-plate', url: '/assets/lp12/landing-awolowo-bg.webp', kind: KIND.image,
    priority: P1, bytes: 86_000, note: 'Page 01 background, generated' },
  // The kit's `installation-complete-scene`. Page 03 keeps the learner's own
  // pole live in its viewport instead, so this is here for the switch rather
  // than in use — see Page14InstallationComplete.
  { id: 'install-plate', url: '/assets/lp12/installation-complete-scene.webp',
    kind: KIND.image, priority: P3, bytes: 220_000, note: 'Page 03 scene, generated' },
  // The kit's `commissioning-complete-bg`. In use on Page 04, replacing the
  // isometric-plus-cutout composite that page shared with Page 01.
  { id: 'commissioning-plate', url: '/assets/lp12/commissioning-complete-bg.webp',
    kind: KIND.image, priority: P3, bytes: 115_000, note: 'Page 04 background, generated' },
  // The replication spec's `double-arm-lighting-column` (its section 32), which
  // that document offers only "if the existing GLB cannot be used". The GLB CAN
  // be used and still is — it is the model the whole assembly runs on — but it
  // has no lamp arms, and the arms are the one thing the Pole Overview page is
  // pointing at: its own copy calls the subject an "LP12 small-cell pole with
  // double-arm luminaire", and the reference render shows two curved arms with
  // LED heads. So the overview shows this cutout and the 3D column takes over
  // the moment the installation begins. Bare hardware, deliberately: the page
  // must not show what the learner has not installed yet.
  { id: 'pole-column', url: '/assets/lp12/pole-column.webp',
    kind: KIND.image, priority: P2, bytes: 58_000, note: 'Page 04 column, generated' },
  // The kit's `field-assignment-isometric` and `corridor-test-isometric`.
  // NEITHER IS IN USE, deliberately. Page 02's city has to be the same city
  // Page 03 then asks the learner to find a specific column on — that page
  // pins its hotspot to a Blender-projected anchor on our own render, so a
  // generated lookalike beside it would be a second, different Awolowo Way.
  // The corridor screen sits over the live test rather than a still. Both are
  // here because they were generated to the kit's prompts and are one line
  // from being used if the plates are preferred to the render.
  { id: 'assignment-plate', url: '/assets/lp12/field-assignment-isometric.webp',
    kind: KIND.image, priority: P3, bytes: 230_000, note: 'Generated, unused — see note' },
  { id: 'corridor-plate', url: '/assets/lp12/corridor-test-isometric.webp',
    kind: KIND.image, priority: P3, bytes: 200_000, note: 'Generated, unused — see note' },

  /* ---- P2: the installation workspace ---------------------------------- */
  { id: 'lp12', url: '/models/lp12_v2.glb', kind: KIND.gltf, priority: P2, bytes: 1_529_000,
    note: 'LP12 pole, components, 8 clips, cable-flex morph targets' },
  { id: 'environment', url: '/models/awolowo_lowpoly_env.glb', kind: KIND.gltf, priority: P2, bytes: 845_000,
    note: 'Awolowo Way environment, Draco compressed' },
  { id: 'camera-studio', url: '/models/camera_studio.json', kind: KIND.json, priority: P2, bytes: 4_200 },
  { id: 'camera-flow', url: '/models/camera_flow.json', kind: KIND.json, priority: P2, bytes: 4_400 },
  ...['pole-bands', 'mounting-rail', 'pivot-bracket', 'antenna-unit', 'fastener-set', 'connector-set']
    // WebP at card/preview size: the source PNGs were 0.5-1.0 MB each, which
    // is 4 MB of tray thumbnails for six 200 px cards.
    .map((p) => ({ id: `part-${p}`, url: `/lp12/parts/${p}.webp`, kind: KIND.image,
                   priority: P2, bytes: 27_000, note: 'Component card thumbnail' })),
  ...['00_overview', '01_pole_bands', '02_mounting_rail', '03_pivot_bracket',
      '04_antenna_unit', '05_fasteners', '06_connectors', '07_complete']
    .map((w) => ({ id: `wire-${w}`, url: `/lp12/wireframes/${w}.png`, kind: KIND.image,
                   priority: P2, bytes: 30_000, note: 'Stage wireframe / position tracker' })),

  /* ---- P3: the tablet tuning scene -------------------------------------- */
  // The two supplied 1672x941 plates, at the artboard's own size, so the
  // aperture rectangle in tuning-config is measured in the same pixels the
  // browser paints. WebP because the PNGs are 2.6 MB and 1.2 MB; the
  // foreground keeps its alpha, which is what the street shows through.
  { id: 'tablet-foreground', url: '/assets/lp12/tablet-hand-foreground.webp', kind: KIND.image,
    priority: P3, bytes: 49_000, brief: 'tablet-hand-foreground.png',
    note: 'Hand + bezel with real transparency; the device plate' },
  { id: 'street-background', url: '/assets/lp12/street-background.webp', kind: KIND.image,
    priority: P3, bytes: 303_000, brief: 'street-background.png',
    note: 'Awolowo Way backdrop, the plane behind the tablet' },
  { id: 'hand-point', url: '/assets/lp12/hand-point-alpha.webp', kind: KIND.image, priority: P3,
    bytes: 97_000, note: 'Pointing hand, guided overlay' },
  { id: 'hand-tap', url: '/assets/lp12/hand-tap-alpha.webp', kind: KIND.image, priority: P3,
    bytes: 109_000, note: 'Tapping hand, guided overlay' },

  /* ---- Apple-glass redesign, section 7 ----------------------------------
     Registered here so the preloader owns them like everything else; each is
     wired by the page that uses it, as that page is built. */
  { id: 'studio-isolation', url: '/assets/lp12/studio-isolation-gradient.png', kind: KIND.image,
    priority: P2, bytes: 72_000,
    note: 'Warm-white to cool-white ground revealed when the city is removed' },
  { id: 'coverage-dome', url: '/assets/lp12/coverage-dome.png', kind: KIND.image, priority: P2,
    bytes: 20_000, note: 'Coverage lobe plate for the downtilt mini viewport' },
  { id: 'target-ring', url: '/assets/lp12/target-ring.png', kind: KIND.image, priority: P2,
    bytes: 6_000, note: 'Drop-target ring for the installation regions' },
]

/** Assets the brief names that do not exist under that name. */
export const byBriefName = Object.fromEntries(
  ASSETS.filter((a) => a.brief).map((a) => [a.brief, a.url]),
)

export function assetsFor(priority) {
  return ASSETS.filter((a) => a.priority === priority)
}

export function assetById(id) {
  return ASSETS.find((a) => a.id === id)
}

export function urlFor(id) {
  const a = assetById(id)
  if (!a) throw new Error(`Unknown asset id: ${id}`)
  return a.url
}

/** Total weight of a priority band, for progress. */
export function bytesFor(priority) {
  return assetsFor(priority).reduce((s, a) => s + (a.bytes || 0), 0)
}

/**
 * Assets deliberately NOT in the manifest, and why — so the next person does
 * not "fix" the omission:
 *
 *   /assets/lp12/tablet-background.png   the original composite. Superseded by
 *       the cutout and the street plate, which are the same picture in two
 *       layers. 2.5 MB, and nothing references it.
 *   /models/vehicles/*.glb               traffic is off (INCLUDE_VEHICLES in
 *       build_awolowo_env.py). Preloading 10 vehicle GLBs for a scene that
 *       does not place them is 676 KB of waste.
 *   /background.jpg, /background.png     the aerial photograph the locate page
 *       used before the isometric render replaced it.
 *   /background-loop.mp4                 the video plate, dropped with it.
 *   fonts                                the UI is on a system font stack
 *       ("Helvetica Neue", Manrope, Inter, system-ui). Nothing is fetched, so
 *       there is nothing to preload and no font swap to wait for.
 */
export const EXCLUDED = [
  '/assets/lp12/tablet-background.png',
  '/models/vehicles/',
  '/background.jpg',
  '/background.png',
  '/background-loop.mp4',
]
