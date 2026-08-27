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

export default function Page12SetDowntilt({
  value, min, max, step, target, heightM, onChange, onConfirm, notice, busy, children,
}) {
  const [aligned, setAligned] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const done = useRef(false)

  const change = useCallback((e) => onChange(Number(e.target.value)), [onChange])

  const confirm = useCallback(() => {
    if (busy || done.current) return
    if (value !== target) { onConfirm(); return }
    done.current = true
    setAligned(true)
    setTimeout(() => setLeaving(true), ALIGNED_HOLD_MS)
    setTimeout(onConfirm, ALIGNED_HOLD_MS + 420)
  }, [busy, value, target, onConfirm])

  // Degrees around the dial face. The scale is a quarter turn either side of
  // vertical, so the whole range is reachable without the pointer wrapping.
  const sweep = 220
  const t = (value - min) / (max - min)
  const angle = -sweep / 2 + t * sweep

  return (
    <section className="fm-page fm-studio p12" aria-label="Set downtilt">
      <div className="p12-viewport">{children}</div>

      <h1 className="fm-stage-title p12-title">Set downtilt</h1>

      <div className="p12-dial">
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
          aria-valuetext={`${value} degrees, target ${target} degrees`}
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
