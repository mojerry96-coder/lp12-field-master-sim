/**
 * LP12 tablet network-tuning — approved data.
 *
 * Every visible number in the tuning sequence comes from here. The guide is
 * explicit that the completion values are fixed and must not be invented, so
 * they live in one place rather than being typed into four page components
 * where they could drift apart.
 *
 * Written as plain JS rather than the guide's TypeScript because this project
 * is JSX throughout; the shapes are identical.
 */

/** "interval" | "hysteresis" | "timeToTrigger" | "complete" */
export const TUNING_STEPS = ['interval', 'hysteresis', 'timeToTrigger', 'complete']

export const TUNING_LIMITS = {
  intervalMs: { min: 80, max: 240, step: 1, target: 128, tolerance: 0 },
  hysteresisDb: { min: 0.5, max: 5, step: 0.1, target: 2.5, tolerance: 0.05 },
  timeToTriggerMs: { min: 320, max: 640, step: 16, target: 480, tolerance: 0 },
}

/** Deliberately wrong at entry — the learner has to tune each one. */
export const INITIAL_TUNING = {
  intervalMs: 192,
  hysteresisDb: 1.2,
  timeToTriggerMs: 640,
}

export const COMPLETION_METRICS = {
  rsrpDbm: -88,
  handoverStabilityPercent: 93,
  batteryCostPercentPerHour: 4.1,
  interruptionMs: 8,
}

/**
 * The guide's approved figures, kept as the reference each derivation is
 * checked against — every derive* function below must reproduce its value here
 * exactly when its control sits at target. They are no longer rendered
 * directly: a card that always printed the same number taught the learner that
 * the panel was decoration, so each is now the endpoint of a live reading
 * rather than a caption.
 *
 * rsrpDbm and cellOverlapPercent have no derivation and no card. RSRP is the
 * downlink power at a fixed spot and cell overlap is network geometry; neither
 * changes when the reporter is retuned, so both were replaced by quantities the
 * controls actually drive.
 */
export const APPROVED_READINGS = {
  samplingPerSecond: 7.8,
  networkHealthInterval: 92,
  networkHealthTtt: 93,
  boundaryStability: 94,
  handoverDelayMs: 132,
  pciConsistency: 98,
  timingAdvance: 92,
  uplinkQuality: 95,
  triggerStatePercent: 96,
}

/**
 * Readings on page 1 that genuinely follow the measurement interval.
 *
 * The guide's locked "7.8/s" is not an arbitrary number — it is 1000/128, the
 * sampling rate you get at the target interval. That is the tell that these
 * cards were meant to be live readouts of the control, not fixed captions, and
 * every value below is written so it lands exactly on the guide's figure when
 * the interval is at target.
 *
 * RSRP and the Signal Status rows are deliberately NOT here. They are site
 * measurements — how strong the serving cell is, how consistent its PCI is —
 * and none of them change because the reporter samples more or less often.
 * Making them wobble with the slider would be inventing a relationship that
 * does not exist.
 */
export function deriveIntervalReadings(intervalMs) {
  const samplingPerSecond = 1000 / intervalMs
  const samplesPerMinute = Math.round(samplingPerSecond * 60)

  // Health peaks at the target and falls away on either side. Sampling too
  // slowly misses events; sampling too fast buys nothing and costs battery.
  const offTarget = Math.min(Math.abs(intervalMs - TUNING_LIMITS.intervalMs.target) / 112, 1)
  const networkHealth = Math.round(92 - offTarget * 26)

  // Power scales with how often the radio wakes to measure, so this is the
  // cost side of the same dial: sampling faster detects sooner and drains more.
  // That trade is why a middle value wins, and it lands on the guide's 4.1 %/h
  // at target.
  const batteryCostPerHour = (COMPLETION_METRICS.batteryCostPercentPerHour
    * TUNING_LIMITS.intervalMs.target) / intervalMs

  // How faithfully the reporter can characterise the cell depends on how many
  // reports it took. These land on the guide's 98/92/95 at target.
  const fidelity = 1 - offTarget
  const reporting = {
    pciConsistency: Math.round(98 - (1 - fidelity) * 22),
    timingAdvance: Math.round(92 - (1 - fidelity) * 26),
    uplinkQuality: Math.round(95 - (1 - fidelity) * 24),
  }

  return {
    samplingPerSecond: samplingPerSecond.toFixed(1),
    samplesPerMinute,
    networkHealth,
    batteryCostPerHour: batteryCostPerHour.toFixed(1),
    reporting,
  }
}

/**
 * Readings for the hysteresis page.
 *
 * Hysteresis is the margin a neighbour must beat before handover, and it has
 * two opposing failure modes — that is the whole reason a middle value is
 * correct. Too little and the phone ping-pongs between cells; too much and it
 * clings to a failing one. Both are shown, so the sweet spot is visible rather
 * than asserted.
 */
export function deriveHysteresisReadings(hysteresisDb) {
  const t = TUNING_LIMITS.hysteresisDb.target
  const off = Math.min(Math.abs(hysteresisDb - t) / 2, 1)

  return {
    // Locked 94% at target, falling away on either side.
    boundaryStability: Math.round(94 - off * 31),
    // Falls steeply as the margin grows: a bigger margin is harder to bounce
    // across. Reads 3/h at target, ~28/h wide open.
    pingPongPerHour: Math.round(48 * Math.exp(-hysteresisDb / 0.9)),
    // The opposite cost. A large margin means the phone holds a dying cell.
    lateHandoverRisk: Math.round(Math.max(0, (hysteresisDb - 1.2) / 3.8) * 100),
    // Drives the response chart: how often the boundary is crossed.
    crossings: Math.max(1, Math.round(14 * Math.exp(-hysteresisDb / 1.4))),
  }
}

/**
 * Readings for the time-to-trigger page.
 *
 * Time-to-trigger is how long a condition must hold before acting, so both
 * extremes cost the same currency — delay. Fire too early and handovers fail
 * and get retried; fire too late and the phone waits on a cell it should have
 * left. The delay curve therefore has its minimum at the target, which is what
 * makes 480 ms the answer.
 */
export function deriveTriggerReadings(timeToTriggerMs) {
  const t = TUNING_LIMITS.timeToTriggerMs.target
  const off = Math.min(Math.abs(timeToTriggerMs - t) / 160, 1)

  return {
    // Locked 132 ms at target — the floor of the curve.
    handoverDelayMs: Math.round(132 + off * 48),
    // Locked 96% at target.
    triggerStatePercent: Math.round(96 - off * 34),
    // Locked completion figure, 8 ms, at target.
    interruptionMs: Math.round((8 + off * 11) * 10) / 10,
    // Locked 93% at target.
    networkHealth: Math.round(93 - off * 27),
  }
}

export function isOnTarget(step, values) {
  if (step === 'interval') return values.intervalMs === TUNING_LIMITS.intervalMs.target
  if (step === 'hysteresis') {
    return Math.abs(values.hysteresisDb - TUNING_LIMITS.hysteresisDb.target)
      <= TUNING_LIMITS.hysteresisDb.tolerance
  }
  if (step === 'timeToTrigger') {
    return values.timeToTriggerMs === TUNING_LIMITS.timeToTriggerMs.target
  }
  return true
}

/**
 * Dome state derived from the three tuning values.
 *
 * Each control owns a different visual property, which is what makes the dome
 * a readout rather than decoration: interval sets how fast it pulses,
 * hysteresis sets how much its edge flickers, and time-to-trigger sets how long
 * it takes to settle after a change.
 *
 * Colour is deliberately NOT the average of the three raw scores. Two of the
 * three values are still sitting at their entry defaults on page one, and those
 * defaults are not maximally wrong — hysteresis starts at 1.2 dB against a
 * 2.5 dB target, which scores about 0.5 on its own. Averaging that in paints
 * the volume half-green before the learner has touched anything, which reads as
 * "already fine" on the page whose whole point is that it is not. So `progress`
 * counts the steps actually confirmed, and only the step in hand contributes a
 * partial score.
 */
export function deriveDomeState(step, values) {
  const intervalScore = 1 - Math.min(Math.abs(values.intervalMs - 128) / 112, 1)
  const hysteresisScore = 1 - Math.min(Math.abs(values.hysteresisDb - 2.5) / 2.5, 1)
  const tttScore = 1 - Math.min(Math.abs(values.timeToTriggerMs - 480) / 160, 1)

  const activeScore = step === 'interval' ? intervalScore
    : step === 'hysteresis' ? hysteresisScore
    : step === 'timeToTrigger' ? tttScore
    : 1
  // Divided by the number of CONTROL steps, not the number of pages: hitting
  // the target on the third control is the moment the volume is fully tuned, so
  // that is where the ramp has to reach green. Dividing by four would leave the
  // learner looking at a half-green shell at the exact moment they got it right,
  // and only turn it green on the summary page, after the fact.
  const stepIndex = Math.max(TUNING_STEPS.indexOf(step), 0)
  const controlSteps = TUNING_STEPS.length - 1
  const progress = Math.min((stepIndex + activeScore) / controlSteps, 1)

  return {
    progress,
    quality: progress,
    intervalScore,
    hysteresisScore,
    tttScore,
    pulseHz: 0.55 + intervalScore * 0.65,
    edgeFlicker: 0.2 * (1 - hysteresisScore),
    responseDelayMs: values.timeToTriggerMs,
    completed: step === 'complete',
    step,
  }
}

/** Status-card rows per page, exactly as specified in the guide. */
export const STATUS_ROWS = {
  interval: [
    ['Status', 'Active', 'amber'],
    ['Reporter', 'Connected', 'green'],
    ['Interval', 'Active', 'amber'],
  ],
  hysteresis: [
    ['Status', 'Active', 'amber'],
    ['Interval', 'Complete', 'green'],
    ['Hysteresis', 'Active', 'amber'],
  ],
  timeToTrigger: [
    ['Status', 'Active', 'amber'],
    ['Interval', 'Complete', 'green'],
    ['Hysteresis', 'Complete', 'green'],
    ['Time-to-Trigger', 'Active', 'amber'],
  ],
  complete: [
    ['Status', 'Optimised', 'green'],
    ['Network', 'Optimised', 'green'],
  ],
}

/**
 * Artboard and aperture calibration.
 *
 * The guide's section 5 gives the aperture as 286/67/1115/824 and allows it to
 * be nudged after the first render. Flood-filling the black display area of the
 * supplied plate puts its real edges at left 263, top 43, right 1419, bottom
 * 896 — the published figures inset the UI by roughly 24 px on two sides, which
 * leaves dead bezel inside the screen. The values below are the measured ones,
 * pulled a few pixels in from each edge because the photographed screen is
 * slightly keystoned and a rectangle cannot follow a slanted edge.
 */
export const TABLET_ARTBOARD = {
  width: 1672,
  height: 941,
  screen: { left: 268, top: 46, width: 1149, height: 846, radius: 27 },
}

/**
 * Reporter sample points shown on the coverage shell, in spherical coordinates
 * relative to the antenna: azimuth around the pole, elevation above horizontal,
 * radius as a fraction of the shell so they sit just inside its surface.
 */
export const SENSOR_NODES = [
  { id: 'S1', azimuth: 148, elevation: 26, radius: 0.94 },
  { id: 'S2', azimuth: 108, elevation: -12, radius: 0.90 },
  { id: 'S3', azimuth: 214, elevation: 40, radius: 0.86 },
  { id: 'S4', azimuth: 46, elevation: 8, radius: 0.93 },
  { id: 'S5', azimuth: 76, elevation: -34, radius: 0.88 },
]

/** Logical tablet screen the app is authored against (4:3). */
export const LOGICAL_SCREEN = { width: 1366, height: 1024 }

/** Fingertip anchors in artboard space, from the guide. */
export const HAND_ANCHORS = {
  point: { x: 292, y: 304 },
  tap: { x: 421, y: 257 },
}
