import {
  TUNING_LIMITS, deriveIntervalReadings, deriveHysteresisReadings,
  deriveTriggerReadings,
} from './tuning-config'
import { IconPulse, IconBattery, IconShield, IconBars } from './TuningStepPage'

/**
 * What each tuning step puts on the shared shell.
 *
 * The shell is fixed from Page 16 onward by the specification — "only tuning
 * content changes" — so everything that does change is here: the copy, the
 * control's own limits, the stops labelled along the track, and the four
 * consequences.
 *
 * Every tile value comes out of `tuning-config`, never out of this file. A
 * literal typed in here would be a number that stops agreeing with the control
 * the moment anyone touches the model.
 */

/* Stops labelled along the track.
 *
 * The reference renders draw idealised scales — Page 15's is powers of two
 * from 32 to 512 — but the simulation's interval runs 80-240 ms with the
 * target at 128 and the learner starting at 192, which is exactly what that
 * page's own spec text requires. Changing a range to match a drawing would
 * change what is being taught, so the stops are the model's own and the target
 * is marked separately on the track. */

export const TUNING_STEPS = {
  interval: {
    id: 'interval',
    field: 'intervalMs',
    title: 'Measurement Interval',
    subtitle: 'Set how often the device collects network measurements.',
    unit: 'ms',
    unitLong: 'milliseconds',
    decimals: 0,
    limits: TUNING_LIMITS.intervalMs,
    stops: [80, 120, 160, 200, 240],
    applyId: 'apply-interval',
    tiles: (value) => {
      const live = deriveIntervalReadings(value)
      // Confidence is the mean of the three sub-metrics the reporter is scored
      // on, which is what the word means here. Any one of them alone would be
      // a figure chosen to match a drawing.
      const confidence = Math.round(
        (live.reporting.pciConsistency + live.reporting.timingAdvance
         + live.reporting.uplinkQuality) / 3,
      )
      return [
        { icon: IconPulse, label: 'Sampling Rate',
          value: live.samplingPerSecond, unit: '/s',
          state: Number(live.samplingPerSecond) >= 6 ? 'Good' : 'Low' },
        { icon: IconBattery, label: 'Battery Cost',
          value: live.batteryCostPerHour, unit: '%/h',
          state: Number(live.batteryCostPerHour) <= 5 ? 'Optimised' : 'Heavy' },
        { icon: IconShield, label: 'Confidence',
          value: confidence, unit: '%',
          state: confidence >= 90 ? 'High' : 'Limited' },
        { icon: IconBars, label: 'Network Health',
          value: live.networkHealth, unit: '%',
          state: live.networkHealth >= 90 ? 'Excellent' : 'Degraded' },
      ]
    },
  },

  hysteresis: {
    id: 'hysteresis',
    field: 'hysteresisDb',
    title: 'Hysteresis',
    subtitle: 'Set the margin a neighbour must beat before the phone hands over.',
    unit: 'dB',
    unitLong: 'decibels',
    decimals: 1,
    limits: TUNING_LIMITS.hysteresisDb,
    stops: [0.5, 1.5, 2.5, 3.5, 5],
    applyId: 'apply-hysteresis',
    /* The reference's fourth tile is "Network Health", which on this page would
     * be `boundaryStability` under a second name — the same curve, peaking at
     * the same value, in two tiles out of four. Boundary crossings is already
     * derived, genuinely different, and the thing hysteresis physically
     * controls: how often the cell edge gets crossed at all. */
    tiles: (value) => {
      const live = deriveHysteresisReadings(value)
      return [
        { icon: IconShield, label: 'Boundary Stability',
          value: live.boundaryStability, unit: '%',
          state: live.boundaryStability >= 90 ? 'Locked' : 'Unsettled' },
        { icon: IconPulse, label: 'Ping-Pong Risk',
          value: live.pingPongPerHour, unit: '/h',
          state: live.pingPongPerHour <= 5 ? 'Low'
            : live.pingPongPerHour <= 14 ? 'Moderate' : 'High' },
        { icon: IconBattery, label: 'Late Handover Risk',
          value: live.lateHandoverRisk, unit: '%',
          state: live.lateHandoverRisk <= 40 ? 'Acceptable' : 'Elevated' },
        { icon: IconBars, label: 'Boundary Crossings',
          value: live.crossings, unit: '/min',
          state: live.crossings <= 4 ? 'Settled' : 'Frequent' },
      ]
    },
  },

  timeToTrigger: {
    id: 'timeToTrigger',
    field: 'timeToTriggerMs',
    title: 'Time-to-Trigger',
    subtitle: 'Set how long the condition must hold before the phone acts.',
    unit: 'ms',
    unitLong: 'milliseconds',
    decimals: 0,
    limits: TUNING_LIMITS.timeToTriggerMs,
    stops: [320, 400, 480, 560, 640],
    applyId: 'apply-trigger',
    /* Both extremes cost the same currency here — delay. Fire too early and
     * handovers fail and get retried; fire too late and the phone waits on a
     * cell it should already have left. So the response figures are the tiles,
     * and they bottom out together at the target. */
    tiles: (value) => {
      const live = deriveTriggerReadings(value)
      return [
        { icon: IconPulse, label: 'Handover Delay',
          value: live.handoverDelayMs, unit: 'ms',
          state: live.handoverDelayMs <= 150 ? 'Prompt' : 'Sluggish' },
        { icon: IconShield, label: 'Trigger State',
          value: live.triggerStatePercent, unit: '%',
          state: live.triggerStatePercent >= 90 ? 'Stable' : 'Premature' },
        { icon: IconBattery, label: 'Interruption',
          value: live.interruptionMs, unit: 'ms',
          state: live.interruptionMs <= 10 ? 'Imperceptible' : 'Audible' },
        { icon: IconBars, label: 'Network Health',
          value: live.networkHealth, unit: '%',
          state: live.networkHealth >= 90 ? 'Excellent' : 'Degraded' },
      ]
    },
  },
}
