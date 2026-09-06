import { useCallback, useRef, useState } from 'react'
import CoverageMiniViewport from '../components/CoverageMiniViewport'

/**
 * PAGE 12 — Set Downtilt + Live Coverage Mini View.
 *
 * A close mechanical view of the antenna and its pivot, the dial on the left,
 * and the coverage consequence in a panel anchored inside the 3D area at the
 * lower right — not in a sidebar, because the point is that it belongs to the
 * scene it is describing.
 *
 * The full-scene coverage dome is off on this page. It is the same information
 * the mini viewport carries, and shown at scene size it swallows the hinge
 * geometry this page exists to let the learner watch.
 *
 * Confirmation is the panel's own exit: on a correct tilt the coverage settles,
 * "Coverage aligned" appears for a beat, the panel contracts away, and only
 * then does the page hand over (2.7). A wrong tilt does none of that — it goes
 * straight to the refusal, because there is nothing aligned to say.
 */
const ALIGNED_HOLD_MS = 900

/* Degrees the needle sweeps end to end. A quarter turn either side of vertical,
   so the whole range is reachable without the pointer wrapping past the top. */
const SWEEP = 220

export default function Page12SetDowntilt({
  value, min, max, step, target, heightM, onChange, onConfirm, notice, busy, children,
}) {
  const [aligned, setAligned] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [turning, setTurning] = useState(false)
  const done = useRef(false)
  const dialRef = useRef(null)

  const change = useCallback((e) => onChange(Number(e.target.value)), [onChange])

  /**
   * Turning the dial.
   *
   * The control used to be an invisible range input pinned to a strip across
   * the bottom of the face, so the grab cursor only appeared in a band a few
   * pixels tall and the learner had to hunt the 240px knob for the one place it
   * answered. Worse, it answered to sideways dragging — a knob that turns when
   * you pull it left is not a knob.
   *
   * So the pointer angle around the centre drives the value directly: the
   * needle goes where the finger is, which is what makes it read as hardware.
   * The range input stays for the keyboard and for assistive tech; it is simply
   * no longer the thing the mouse talks to.
   */
  const valueFromPointer = useCallback((e) => {
    const el = dialRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    // Zero pointing up, positive clockwise — the same convention the needle's
    // CSS rotation uses, so the two cannot disagree about which way is which.
    const deg = Math.atan2(dx, -dy) * (180 / Math.PI)
    const clamped = Math.max(-SWEEP / 2, Math.min(SWEEP / 2, deg))
    const t = (clamped + SWEEP / 2) / SWEEP
    const raw = min + t * (max - min)
    // Onto the step grid, or the dial reports 4.87 degrees and the gate that
    // compares against a whole number never matches.
    return Math.max(min, Math.min(max, Math.round(raw / step) * step))
  }, [min, max, step])

  const turnTo = useCallback((e) => {
    const next = valueFromPointer(e)
    if (next !== null && next !== value) onChange(next)
  }, [valueFromPointer, onChange, value])

  const onPointerDown = useCallback((e) => {
    if (busy || aligned) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setTurning(true)
    turnTo(e)
  }, [busy, aligned, turnTo])

  const onPointerMove = useCallback((e) => {
    if (!turning) return
    turnTo(e)
  }, [turning, turnTo])

  const endTurn = useCallback((e) => {
    if (!turning) return
    setTurning(false)
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [turning])

  const confirm = useCallback(() => {
    if (busy || done.current) return
    if (value !== target) { onConfirm(); return }
    done.current = true
    setAligned(true)
    setTimeout(() => setLeaving(true), ALIGNED_HOLD_MS)
    setTimeout(onConfirm, ALIGNED_HOLD_MS + 420)
  }, [busy, value, target, onConfirm])

  const t = (value - min) / (max - min)
  const angle = -SWEEP / 2 + t * SWEEP

  return (
    <section className="fm-page fm-studio p12" aria-label="Set downtilt">
      <div className="p12-viewport">{children}</div>

      <h1 className="fm-stage-title p12-title">Set downtilt</h1>

      <div
        ref={dialRef}
        className={`p12-dial${turning ? ' is-turning' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endTurn}
        onPointerCancel={endTurn}
      >
        <span className="p12-dial-face" aria-hidden="true">
          <i className="p12-dial-needle" style={{ transform: `rotate(${angle}deg)` }} />
        </span>

        <b className="p12-value">{value}<sup>°</sup></b>
        <span className="p12-label">Downtilt</span>

        <input
          className="p12-input"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={busy}
          onChange={change}
          aria-label="Downtilt in degrees"
          aria-valuetext={`${value} degrees`}
        />
      </div>

      <CoverageMiniViewport heightM={heightM} tiltDeg={value}
                            aligned={aligned} leaving={leaving} />

      {notice && <div className="fm-glass p12-notice" role="alert">{notice}</div>}

      <button className="fm-btn fm-btn--trailing p12-confirm" type="button"
              onClick={confirm} disabled={busy || aligned}>
        Confirm Downtilt
        <span className="fm-btn-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
                  strokeLinejoin="round" d="M4 12h15m-6-6 6 6-6 6" />
          </svg>
        </span>
      </button>
    </section>
  )
}
