import { useEffect, useRef, useState } from 'react'
import { P1, preload } from '../lib/preloader'

/**
 * Institutional opener.
 *
 * NO LOGO FILE EXISTS IN THIS PROJECT. The brief says to use the approved MIVA
 * mark if it is available and not to recreate it — it is not available, and
 * inventing one would put an unapproved mark in front of every learner. So the
 * opener is typographic, and the slot below is where the real asset drops in:
 * add it to the manifest, render it inside .miva-mark, and nothing else here
 * has to change.
 *
 * The opener is also the preload window. It is not a splash screen that costs
 * three seconds — it spends three seconds that were going to be spent anyway,
 * on the P1 band. Two conditions gate the exit:
 *
 *   the cinematic minimum has elapsed, AND
 *   the first scene's assets are decoded
 *
 * If assets win, the opener plays out its remaining time and leaves. If the
 * clock wins, the finished title holds and a real percentage appears beneath
 * it. The percentage is byte-weighted progress from the preloader, never a
 * timer pretending to be one.
 */

const BEATS = {
  atmosphere: 400,     // 0.0-0.4  dark, blue light rises
  mark: 1300,          // 0.4-1.3  the mark resolves
  title: 2400,         // 1.3-2.4  MIVA OPEN UNIVERSITY
  hold: 3200,          // 2.4-3.2  hold, then hand over
}
const REDUCED_HOLD = 900        // brief: 800-1000 ms, static
const SKIPPABLE_AFTER = 800     // brief: 700-900 ms

export default function MivaOpener({ reducedMotion, onDone, skippable = false }) {
  const [phase, setPhase] = useState('atmosphere')
  const [progress, setProgress] = useState(0)
  const [stalled, setStalled] = useState(false)
  const [canSkip, setCanSkip] = useState(false)
  const assetsReady = useRef(false)
  const clockDone = useRef(false)
  const finished = useRef(false)

  // Both gates call this; the second one through is the one that leaves.
  const maybeFinish = useRef(() => {})
  maybeFinish.current = () => {
    if (finished.current) return
    if (!clockDone.current || !assetsReady.current) {
      if (clockDone.current && !assetsReady.current) setStalled(true)
      return
    }
    finished.current = true
    onDone()
  }

  useEffect(() => {
    preload(P1, setProgress)
      .catch(() => { /* the stage gate reports failures; the opener still leaves */ })
      .finally(() => { assetsReady.current = true; maybeFinish.current() })
  }, [])

  useEffect(() => {
    const timers = []
    if (reducedMotion) {
      setPhase('title')
      timers.push(setTimeout(() => { clockDone.current = true; maybeFinish.current() }, REDUCED_HOLD))
    } else {
      timers.push(setTimeout(() => setPhase('mark'), BEATS.atmosphere))
      timers.push(setTimeout(() => setPhase('title'), BEATS.mark))
      timers.push(setTimeout(() => setPhase('hold'), BEATS.title))
      timers.push(setTimeout(() => { clockDone.current = true; maybeFinish.current() }, BEATS.hold))
    }
    if (skippable) timers.push(setTimeout(() => setCanSkip(true), SKIPPABLE_AFTER))
    return () => timers.forEach(clearTimeout)
  }, [reducedMotion, skippable])

  const skip = () => {
    if (finished.current) return
    finished.current = true
    onDone()
  }

  return (
    <div className={`miva-opener phase-${phase}${reducedMotion ? ' is-reduced' : ''}`}
         role="img" aria-label="MIVA Open University — Interactive Network Installation Simulation">
      <div className="miva-atmosphere" aria-hidden="true" />
      {!reducedMotion && <div className="miva-sweep" aria-hidden="true" />}

      <div className="miva-stack">
        {/* Slot for the approved mark. Empty by design — see the note above. */}
        <div className="miva-mark" aria-hidden="true" />
        <h1 className="miva-title">MIVA OPEN UNIVERSITY</h1>
        <p className="miva-sub">Interactive Network Installation Simulation</p>

        {/* Only if the clock beat the assets. Never a decorative bar. */}
        {stalled && (
          <div className="miva-status" role="status">
            <span className="miva-status-line">
              <i style={{ transform: `scaleX(${progress})` }} />
            </span>
            <span className="miva-status-text">
              Preparing simulation — {Math.round(progress * 100)}%
            </span>
          </div>
        )}
      </div>

      {canSkip && (
        <button type="button" className="miva-skip" onClick={skip}>Skip</button>
      )}
    </div>
  )
}
