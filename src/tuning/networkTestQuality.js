import * as THREE from 'three'

/**
 * What the network test actually measures.
 *
 * Five learner decisions, five curves, one verdict. The formulas are the
 * specification's own (sections 16 and 18-21) — kept here as pure functions so
 * the 3D scene, the result panel and the score all read the same numbers and
 * cannot disagree about whether the learner passed.
 *
 * Two rules this file exists to enforce:
 *
 *   The test evaluates exactly what the learner selected. Nothing in here
 *   nudges a value toward its target (section 52), because a test that quietly
 *   corrects the thing it is testing measures nothing.
 *
 *   The thresholds are not disclosed before the test (section 21). They live
 *   here, not on the tuning screens, which is also why those screens no longer
 *   mark the correct position on their tracks.
 */

/** The values the site was planned around. */
export const IDEAL = {
  mountHeight: 7.5,
  downtilt: 5,
  measurementInterval: 128,
  hysteresis: 2.5,
  timeToTrigger: 480,
}

/* Each curve is 1 at the target and falls to 0 at the edge of what the site
   can tolerate. The denominators are the specification's, and they differ on
   purpose: a metre of mount height costs far more than a millisecond of
   time-to-trigger. */
const falloff = (value, ideal, tolerance) =>
  THREE.MathUtils.clamp(1 - Math.abs(value - ideal) / tolerance, 0, 1)

export const heightQuality = (h) => falloff(h, IDEAL.mountHeight, 4.5)
export const tiltQuality = (t) => falloff(t, IDEAL.downtilt, 8)
export const intervalQuality = (v) => falloff(v, IDEAL.measurementInterval, 384)
export const hysteresisQuality = (v) => falloff(v, IDEAL.hysteresis, 4)
export const tttQuality = (v) => falloff(v, IDEAL.timeToTrigger, 320)

/**
 * The two halves of the verdict, and their weighting.
 *
 * Physical is what the hardware can reach; tuning is what the reporter does
 * with it. Tuning carries slightly more (0.52 to 0.48) because three decisions
 * feed it against the physical side's two — the weighting keeps a single bad
 * choice worth about the same wherever it was made.
 */
export function calculateTestQuality(settings) {
  const physical = (heightQuality(settings.mountHeight)
    + tiltQuality(settings.downtilt)) / 2

  const tuning = (intervalQuality(settings.measurementInterval)
    + hysteresisQuality(settings.hysteresis)
    + tttQuality(settings.timeToTrigger)) / 3

  return { physical, tuning, overall: physical * 0.48 + tuning * 0.52 }
}

const band = (value, good, warn) =>
  (value >= good ? 'good' : value >= warn ? 'warning' : 'failed')

/**
 * The four rows, resolved.
 *
 * Coverage reads the physical side alone and stability the tuning side alone,
 * so a learner who reads the panel can tell which half of their work was at
 * fault without being told the answer. Interruption is scored a little harder
 * than stability on the same input: a dropped call is felt before a marginal
 * handover statistic is.
 */
export function buildResult(settings) {
  const q = calculateTestQuality(settings)
  return {
    coverage: band(q.physical, 0.82, 0.65),
    stability: band(q.tuning, 0.82, 0.65),
    interruption: band(q.tuning, 0.76, 0.58),
    overall: band(q.overall, 0.82, 0.65),
    score: Math.round(q.overall * 100),
    quality: q,
  }
}

/** PASS only at the top band; everything else is sent back to be looked at. */
export const verdictLabel = (overall) => (overall === 'good' ? 'PASS' : 'REVIEW')

/**
 * How far along the corridor the beam actually reaches, 0-1.
 *
 * Drives where the travelling probe starts to struggle, so a short footprint
 * is something the learner watches happen rather than something they read.
 */
export const corridorReach = (q) => THREE.MathUtils.clamp(0.34 + q.physical * 0.66, 0, 1)

/**
 * Where the trail breaks up, as fractions along the corridor.
 *
 * Derived from the tuning quality rather than scattered at random: the same
 * settings always produce the same faults in the same places, so a learner who
 * changes one value and runs the test again can see what that change did.
 * Capped at two, because the specification asks for one or two readable
 * failures, not a chaotic screen (section 25).
 */
export function faultPoints(q) {
  if (q.tuning >= 0.82) return []
  const faults = [0.46 + (1 - q.tuning) * 0.18]
  if (q.tuning < 0.62) faults.push(0.74 - (1 - q.tuning) * 0.12)
  return faults
}

/* ------------------------------------------------------- per-decision review */

/**
 * The five decisions, judged one at a time.
 *
 * The corridor gives a verdict on the network as a whole; this is what turns
 * that into something a learner can act on. Each entry knows how to score its
 * own value and how to describe what going wrong in each direction does to the
 * cell — the direction matters, because "too high" and "too low" are opposite
 * mistakes with opposite fixes, and a learner told only "wrong" has to guess.
 *
 * The notes never name the target. The learner is told which way to move and
 * why, and has to make the call again — which is the exercise. `revisit` is
 * the route back to the control that owns the decision.
 */
const DECISIONS = [
  {
    key: 'mountHeight',
    label: 'Mount height',
    unit: 'm',
    revisit: 'height',
    quality: heightQuality,
    over: 'Mounted too high — the beam clears the near lanes and the cell '
      + 'stops serving the traffic directly beneath it.',
    under: 'Mounted too low — the footprint stops short and the far end of '
      + 'the corridor drops out.',
  },
  {
    key: 'downtilt',
    label: 'Downtilt',
    unit: '°',
    revisit: 'downtilt',
    quality: tiltQuality,
    over: 'Tilted too far down — coverage collapses around the base of the '
      + 'pole instead of reaching along the road.',
    under: 'Not enough downtilt — energy is thrown past the corridor and '
      + 'into the buildings beyond it.',
  },
  {
    key: 'measurementInterval',
    label: 'Measurement interval',
    unit: 'ms',
    revisit: 'interval',
    quality: intervalQuality,
    over: 'Sampling too slowly — the reporter misses the moment a neighbour '
      + 'becomes the stronger cell.',
    under: 'Sampling too fast — battery is spent measuring without making '
      + 'the reading any more trustworthy.',
  },
  {
    key: 'hysteresis',
    label: 'Hysteresis',
    unit: 'dB',
    revisit: 'hysteresis',
    quality: hysteresisQuality,
    over: 'Margin too wide — the phone holds a weakening cell long after a '
      + 'better one is available.',
    under: 'Margin too narrow — the phone ping-pongs between cells every '
      + 'time it crosses the boundary.',
  },
  {
    key: 'timeToTrigger',
    label: 'Time-to-trigger',
    unit: 'ms',
    revisit: 'timeToTrigger',
    quality: tttQuality,
    over: 'Waiting too long — the phone stays on a cell it should already '
      + 'have left, and the call breaks up first.',
    under: 'Firing too early — brief fades trigger handovers that fail and '
      + 'have to be retried.',
  },
]

/* Above this, a decision is treated as the right call. Deliberately not the
   exact target: the sliders move in real steps, and failing someone for one
   step of hysteresis would be marking precision rather than understanding. */
const DECISION_PASS = 0.97
const DECISION_NEAR = 0.72

/**
 * Every decision the learner made, with a verdict and — where they went wrong
 * — the reason the corridor behaved the way it did.
 */
export function reviewDecisions(settings) {
  return DECISIONS.map((d) => {
    const value = settings[d.key]
    const q = d.quality(value)
    const state = q >= DECISION_PASS ? 'good' : q >= DECISION_NEAR ? 'near' : 'off'
    return {
      key: d.key,
      label: d.label,
      unit: d.unit,
      revisit: d.revisit,
      value,
      quality: q,
      state,
      note: state === 'good' ? null
        : value > IDEAL[d.key] ? d.over : d.under,
    }
  })
}
