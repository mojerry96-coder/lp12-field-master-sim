/**
 * Network coverage geometry.
 *
 * One source of truth for the dome radius, shared by the installation viewport
 * and the network map so the two can never disagree about how far this cell
 * reaches.
 *
 * The radius is not a fixed property of the LP12. It falls out of how the
 * learner has set the rig:
 *
 *     radius = mountHeight / tan(downtilt)
 *
 * which is the ground distance at which the beam centre lands. That makes the
 * dome a readout of the two things this simulation actually teaches — at the
 * correct 7.5 m and 5° it reaches ~86 m; wind the downtilt to 10° and it
 * tightens to ~43 m; raise the mast and it widens. A dome with a hardcoded
 * radius would show none of that.
 */

/**
 * Design target for this site, from the model manifest (height.idealMetres and
 * downtilt.correctDegrees).
 *
 * The network map falls back to these until the site is commissioned. A fresh
 * session has downtilt 0, which is a legitimate selectable value but means a
 * horizontal beam — the radius then clamps to MAX and the dome grows larger
 * than the plate, so the map just acquires a faint tint with no dome visible
 * anywhere. Showing the PLANNED footprint until the learner has installed is
 * both more useful and more truthful: that is what the site is specified to
 * cover, and it becomes their number the moment they commission it.
 */
export const PLANNED_HEIGHT_M = 7.5
export const PLANNED_DOWNTILT_DEG = 5

/** Downtilt at or below this is treated as horizontal — tan() runs away. */
const MIN_TILT_DEG = 0.25

/** Clamp for a near-horizontal beam. Also the dome's authored max in Blender. */
export const MAX_COVERAGE_RADIUS_M = 250

export function coverageRadiusM(heightM, downtiltDeg) {
  if (!Number.isFinite(heightM) || !Number.isFinite(downtiltDeg)) {
    return MAX_COVERAGE_RADIUS_M
  }
  if (downtiltDeg <= MIN_TILT_DEG) return MAX_COVERAGE_RADIUS_M
  const r = heightM / Math.tan((downtiltDeg * Math.PI) / 180)
  return Math.min(MAX_COVERAGE_RADIUS_M, Math.max(1, r))
}


/**
 * The radius both surfaces actually draw.
 *
 * Falls back to the planned footprint when no downtilt has been dialled in.
 * Zero is the app's default and the installation flow never sets it, so the
 * live value is 0 in practice — which means a horizontal beam, clamps to MAX,
 * and produces a dome larger than either camera can stand outside of. Both the
 * network map and the 3D coverage stage then show a faint full-frame tint and
 * no readable dome at all.
 *
 * A learner who deliberately picks 0 deg therefore sees the planned dome
 * rather than an unbounded one. That is the intended trade: 0 is far more
 * often "not set yet" than "chosen", and an unbounded footprint communicates
 * nothing either way.
 *
 * Both surfaces call THIS, not coverageRadiusM directly, so they cannot
 * disagree about how far the cell reaches.
 */
export function effectiveCoverageRadiusM(heightM, downtiltDeg) {
  if (!Number.isFinite(downtiltDeg) || downtiltDeg <= MIN_TILT_DEG) {
    return coverageRadiusM(PLANNED_HEIGHT_M, PLANNED_DOWNTILT_DEG)
  }
  return coverageRadiusM(heightM, downtiltDeg)
}

/**
 * Scale of the aerial plate, for drawing the footprint on the network map.
 *
 * ESTIMATED, not surveyed: taken from the Awolowo Way carriageway, which reads
 * about 150 px across in the source image for a dual carriageway of roughly
 * 28 m including the median. It is isolated here as one number precisely
 * because it is the weakest figure in this file — correct it here and both the
 * dome and any future map overlay follow.
 */
export const MAP_METRES_PER_PIXEL = 0.19

/** Natural size of background.jpg, matching Hotspot.jsx's SOURCE_SIZE. */
export const MAP_SOURCE_SIZE = { width: 1672, height: 941 }

/** Where the LP12 sits on the plate, matching Hotspot.jsx's anchor. */
export const MAP_LP12_ANCHOR = { x: 0.698, y: 0.64 }

/**
 * Camera elevation used for the map overlay, in degrees above the horizon.
 * The plate is a high-oblique aerial, so a dome drawn straight down would not
 * sit on the street. Eyeballed against the building faces and road markings.
 */
export const MAP_VIEW_ELEVATION_DEG = 52
