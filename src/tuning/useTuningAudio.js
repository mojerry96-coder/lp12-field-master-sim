import { useCallback, useEffect, useRef } from 'react'
import {
  preloadTuningSfx, startTuningSearch, updateTuningSearch, stopTuningSearch,
  tuningCorrect,
} from '../lib/sfx'

/**
 * The sound of tuning — and nothing on screen.
 *
 * The three tablet sliders are the same problem three times: the learner has
 * to find a value the interface deliberately refuses to mark. This gives the
 * search a texture. A radio-tuning bed plays only while they are actually
 * moving a control, and its clarity — a lowpass corner, then a little level —
 * follows how near the value is. Landing on the accepted value fades the bed
 * and confirms once.
 *
 * The target is never written here. It comes from the step's own `limits`,
 * the same object the page and the corridor test read, so there is exactly one
 * set of correct numbers in the simulation.
 */

/* Only the last quarter-ish of the travel should audibly improve; before that
   the learner is searching, not warming. */
const NEAR_FRACTION = 0.28

/* How far they must leave before the confirmation can be earned again — a
   couple of detents, or a few percent of travel on the coarse controls. So a
   jitter on the answer does not chime repeatedly. */
const REARM_FRACTION = 0.035

/* Holding still is not tuning. */
const IDLE_MS = 500
const IDLE_TRIM = 0.7

/* A key press or a nudge button is a movement without a hold, so the bed has
   to time out on its own. */
const KEY_TAIL_MS = 300

function proximityCurve(value, target, min, max) {
  const range = max - min
  if (!(range > 0)) return 0
  const near = range * NEAR_FRACTION
  const raw = 1 - Math.min(Math.abs(value - target) / near, 1)
  return raw * raw * (3 - 2 * raw)          // smoothstep
}

export default function useTuningAudio(limits) {
  const l = limits
  const holding = useRef(false)
  const latched = useRef(false)
  const armed = useRef(true)
  const idleTimer = useRef(null)
  const tailTimer = useRef(null)
  const lastProximity = useRef(0)

  useEffect(() => { preloadTuningSfx() }, [])

  const clearTimers = () => {
    if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null }
    if (tailTimer.current) { clearTimeout(tailTimer.current); tailTimer.current = null }
  }

  /** Leaving the step, the page, or the sequence takes the bed with it. */
  useEffect(() => () => { clearTimers(); stopTuningSearch() }, [])

  /* A new step is a new control: drop any latch carried over from the last. */
  useEffect(() => {
    latched.current = false
    armed.current = true
    holding.current = false
    clearTimers()
    stopTuningSearch()
  }, [l])

  const scheduleIdle = useCallback((proximity) => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null
      if (holding.current) updateTuningSearch(proximity, IDLE_TRIM)
    }, IDLE_MS)
  }, [])

  /** The learner has taken hold of the control. */
  const onPointerDown = useCallback((value) => {
    holding.current = true
    if (tailTimer.current) { clearTimeout(tailTimer.current); tailTimer.current = null }
    const correct = Math.abs(value - l.target) <= (l.tolerance || 0)
    if (correct) return                        // already there; nothing to search for
    const p = proximityCurve(value, l.target, l.min, l.max)
    lastProximity.current = p
    startTuningSearch(p)
    scheduleIdle(p)
  }, [l, scheduleIdle])

  /** Released. If they are not on the answer, the bed goes quiet. */
  const onPointerUp = useCallback(() => {
    holding.current = false
    clearTimers()
    stopTuningSearch()
  }, [])

  /**
   * Every accepted value change, from any route into the control.
   *
   * Fires after the page has committed the number, never before: the sound
   * describes the value, it does not choose it. Nothing here writes back.
   */
  const onValueChange = useCallback((value) => {
    const correct = Math.abs(value - l.target) <= (l.tolerance || 0)

    if (correct) {
      if (!latched.current && armed.current) {
        latched.current = true
        armed.current = false
        clearTimers()
        tuningCorrect()
      } else {
        stopTuningSearch()
      }
      return
    }

    latched.current = false
    // Re-arm only once they have genuinely left, so a step off and back does
    // not buy a second confirmation.
    const rearm = Math.max(l.step * 2, (l.max - l.min) * REARM_FRACTION)
    if (Math.abs(value - l.target) >= rearm) armed.current = true

    const p = proximityCurve(value, l.target, l.min, l.max)
    lastProximity.current = p
    startTuningSearch(p)
    updateTuningSearch(p)

    if (holding.current) {
      scheduleIdle(p)
    } else {
      // Keyboard or nudge button: a short tail, extended by further presses.
      if (tailTimer.current) clearTimeout(tailTimer.current)
      tailTimer.current = setTimeout(() => {
        tailTimer.current = null
        if (!holding.current) stopTuningSearch()
      }, KEY_TAIL_MS)
    }
  }, [l, scheduleIdle])

  return { onPointerDown, onPointerUp, onValueChange }
}
