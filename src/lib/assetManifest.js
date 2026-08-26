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
 * A note on names. The brief asked for `street-background(1).png` and
 * `tablet-hand-foreground(1).png`. Neither exists under those names — the
 * project has `street-plate.jpg` and `tablet-cutout.webp`, which are the same
 * two layers, cut out of the original composite plate. The manifest maps the
 * brief's names onto the real files rather than renaming assets to match a
 * document, so `byBriefName` below is there for anyone searching for either.
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

  /* ---- P2: the installation workspace ---------------------------------- */
  { id: 'lp12', url: '/models/lp12_v2.glb', kind: KIND.gltf, priority: P2, bytes: 1_529_000,
    note: 'LP12 pole, components, 8 clips, cable-flex morph targets' },
  { id: 'environment', url: '/models/awolowo_lowpoly_env.glb', kind: KIND.gltf, priority: P2, bytes: 845_000,
    note: 'Awolowo Way environment, Draco compressed' },
  { id: 'camera-studio', url: '/models/camera_studio.json', kind: KIND.json, priority: P2, bytes: 4_200 },
  { id: 'camera-flow', url: '/models/camera_flow.json', kind: KIND.json, priority: P2, bytes: 4_400 },
  ...['pole-bands', 'mounting-rail', 'pivot-bracket', 'antenna-unit', 'fastener-set', 'connector-set']
    .map((p) => ({ id: `part-${p}`, url: `/lp12/parts/${p}.png`, kind: KIND.image,
                   priority: P2, bytes: 40_000, note: 'Component card thumbnail' })),
  ...['00_overview', '01_pole_bands', '02_mounting_rail', '03_pivot_bracket',
      '04_antenna_unit', '05_fasteners', '06_connectors', '07_complete']
    .map((w) => ({ id: `wire-${w}`, url: `/lp12/wireframes/${w}.png`, kind: KIND.image,
                   priority: P2, bytes: 30_000, note: 'Stage wireframe / position tracker' })),

  /* ---- P3: the tablet tuning scene -------------------------------------- */
  { id: 'tablet-foreground', url: '/assets/lp12/tablet-cutout.webp', kind: KIND.image, priority: P3,
    bytes: 48_000, brief: 'tablet-hand-foreground(1).png',
    note: 'Hand + tablet, cut out of the original composite' },
  { id: 'street-background', url: '/assets/lp12/street-plate.jpg', kind: KIND.image, priority: P3,
    bytes: 73_000, brief: 'street-background(1).png',
    note: 'Awolowo Way backdrop with the tablet diffused out' },
  { id: 'hand-point', url: '/assets/lp12/hand-point-alpha.webp', kind: KIND.image, priority: P3,
    bytes: 97_000, note: 'Pointing hand, guided overlay' },
  { id: 'hand-tap', url: '/assets/lp12/hand-tap-alpha.webp', kind: KIND.image, priority: P3,
    bytes: 109_000, note: 'Tapping hand, guided overlay' },
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
