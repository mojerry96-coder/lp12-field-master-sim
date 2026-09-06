import { useCallback } from 'react'

/**
 * PAGE 11 — Set Mount Height.
 *
 * Still the isolated studio, camera widened to the whole pole so the height is
 * something you judge against the column rather than read off a number. The
 * instruction sits on glass at the left, the control runs vertically at the
 * right, and the model itself moves — the specification is explicit that the
 * movement must be in the 3D rig, not simulated in the UI, and Height_Rig is
 * driven live from the same value this control writes.
 *
 * The track is drawn rather than styled onto the native input, but the native
 * input is still what the learner operates: it sits transparent over the top,
 * so arrows, Page Up/Down, Home/End and pointer drags all behave the way a
 * range input is supposed to, and the visible parts follow the value.
 */
export default function Page11SetMountHeight({
  value, min, max, step, onChange, onConfirm, notice, busy, children,
}) {
  // 0 at the bottom of the track, 1 at the top.
  const t = (value - min) / (max - min)

  const change = useCallback((e) => onChange(Number(e.target.value)), [onChange])

  return (
    <section className="fm-page fm-studio p11" aria-label="Set mount height">
      <div className="p11-viewport">{children}</div>

      <div className="fm-glass p11-sheet">
        <h1 className="fm-stage-title p11-title">
          <span>Set mount</span> <span>height</span>
        </h1>
        <p className="fm-helper p11-helper">
          Adjust until the antenna reaches the correct site position.
        </p>
      </div>

      <div className="p11-control">
        <div className="p11-track">
          {/* Fill from the bottom to the knob: the quantity is a height, so it
              reads as a column filling rather than a dot on a line. */}
          <span className="p11-fill" style={{ height: `${t * 100}%` }} aria-hidden="true" />
          <span className="p11-knob" style={{ bottom: `${t * 100}%` }} aria-hidden="true" />

          <span className="fm-glass p11-value" style={{ bottom: `${t * 100}%` }}>
            {value.toFixed(1)} <small>m</small>
          </span>

          <input
            className="p11-input"
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={busy}
            onChange={change}
            aria-label="Mount height in metres"
            aria-valuetext={`${value.toFixed(1)} metres`}
          />
        </div>
      </div>

      {notice && <div className="fm-glass p11-notice" role="alert">{notice}</div>}

      <button className="fm-btn fm-btn--trailing p11-confirm" type="button"
              onClick={onConfirm} disabled={busy}>
        Confirm Height
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
