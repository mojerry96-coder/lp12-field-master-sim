import { useCallback, useId } from 'react'

/**
 * The tuning step shell — PAGES 15-17.
 *
 * One component, not one per decision. From Page 16 the specification is
 * explicit: "keep tablet, hands, camera and screen boundaries exactly the same
 * as Page 15. Only tuning content changes. This continuity is important." The
 * later reference renders drift — Page 16 drops the value card and the stepped
 * track — but a shell that changes between steps is the thing that sentence
 * forbids, so the shell is Page 15's and the steps supply content.
 *
 * The tablet screen is the whole product here: header, one decision, its
 * consequences, and the way to commit it. The reference renders for all four
 * tuning pages show no 3D panel on the tablet, so the live viewport is off on
 * these steps — the tablet IS the media section 2.2 wants primary.
 *
 * Every tile is derived from the control, not written down. `tuning-config`
 * computes them, which is why they cannot drift from the value above them.
 */

function Tile({ icon, label, value, unit, state }) {
  return (
    <div className="ts-tile">
      <span className="ts-tile-head">
        {icon}
        {label}
      </span>
      <strong className="ts-tile-value">
        {value}{unit && <small>{unit}</small>}
      </strong>
      <span className="ts-tile-state"><i aria-hidden="true" />{state}</span>
    </div>
  )
}

export const IconPulse = (
  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
          strokeLinejoin="round" d="M2 12h4l3-7 4 14 3-7h6" />
  </svg>
)
export const IconBattery = (
  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
    <rect x="2" y="7" width="16" height="10" rx="3" fill="none"
          stroke="currentColor" strokeWidth="1.8" />
    <path d="M21 10.5v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <rect x="4.5" y="9.5" width="7" height="5" rx="1.4" fill="currentColor" />
  </svg>
)
export const IconShield = (
  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"
          d="M12 2.8l7 3v5.4c0 4.4-3 8.3-7 10-4-1.7-7-5.6-7-10V5.8z" />
    <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
          strokeLinejoin="round" d="M9 12l2 2 4-4" />
  </svg>
)
export const IconBars = (
  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
    <rect x="3" y="14" width="3.4" height="7" rx="1" fill="currentColor" />
    <rect x="8.5" y="10" width="3.4" height="11" rx="1" fill="currentColor" />
    <rect x="14" y="6" width="3.4" height="15" rx="1" fill="currentColor" />
    <rect x="19.5" y="3" width="1.5" height="18" rx="0.7" fill="currentColor" />
  </svg>
)

/* How much of the control's travel still counts as "close". A tenth either
   side: near enough to read as nearly-there, narrow enough that most of the
   track is not it. */
const CLOSE_BAND = 0.10

export default function TuningStepPage({ step, value, onChange, onApply }) {
  const l = step.limits
  const id = useId()
  const tiles = step.tiles(value)

  const span = l.max - l.min
  const progress = ((value - l.min) / span) * 100

  /**
   * How near the setting is, in three bands, for the slider's colour.
   *
   * The band is measured as a fraction of the control's FULL TRAVEL rather
   * than in its own unit, because the three steps are not comparable in units
   * — a millisecond of interval, a decibel of hysteresis and a millisecond of
   * time-to-trigger mean completely different amounts of "nearly". A tenth of
   * the journey means the same thing on all three, and it is what the learner
   * actually perceives, since all they can see is how far along the track the
   * knob has moved.
   *
   * `tolerance` is the step's own: the interval and the trigger want an exact
   * value, while hysteresis moves in 0.1 dB and cannot be compared exactly —
   * 1.2 + 0.1 is 1.3000000000000003 — so it carries a small one.
   */
  const distance = Math.abs(value - l.target)
  const proximity = distance <= (l.tolerance || 0)
    ? 'correct'
    : distance <= span * CLOSE_BAND
      ? 'close'
      : 'off'

  const nudgeBy = useCallback((delta) => {
    const next = Math.min(l.max, Math.max(l.min, value + delta))
    // Snap back onto the step grid: 1.2 + 0.1 is 1.3000000000000003, and a
    // value a millionth off the grid never equals its target.
    onChange(Number(next.toFixed(step.decimals)))
  }, [onChange, value, l.min, l.max, step.decimals])

  return (
    <div className="ts">
      <h1 className="ts-title">{step.title}</h1>
      <p className="ts-sub">{step.subtitle}</p>

      {/* The readout states the learner's own value and nothing about whether
          it is the right one. Sections 1.3 and 50: the Network Test is what
          proves the answer now, so no control may confirm it beforehand. */}
      <div className="ts-value">
        <strong>{value.toFixed(step.decimals)} <small>{step.unit}</small></strong>
        <span className="ts-value-note">Current Setting</span>
      </div>

      <div className="ts-control">
        <button type="button" className="ts-step" aria-label={`Decrease ${step.title}`}
                onClick={() => nudgeBy(-l.step)}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  strokeLinejoin="round" d="M15 6l-6 6 6 6" />
          </svg>
        </button>

        <div className="ts-track-wrap">
          <div className={`ts-track is-${proximity}`}>
            <span className="ts-fill" style={{ width: `${progress}%` }} aria-hidden="true" />
            <input
              id={id}
              type="range"
              min={l.min}
              max={l.max}
              step={l.step}
              value={value}
              onChange={(e) => onChange(Number(e.target.value))}
              aria-label={`${step.title} in ${step.unitLong}`}
              aria-valuetext={`${value.toFixed(step.decimals)} ${step.unitLong}`}
            />
          </div>
          <div className="ts-stops" aria-hidden="true">
            {step.stops.map((stop) => (
              <span key={stop} className={stop === value ? 'is-current' : undefined}
                    style={{ left: `${((stop - l.min) / span) * 100}%` }}>{stop}</span>
            ))}
          </div>
        </div>

        <button type="button" className="ts-step" aria-label={`Increase ${step.title}`}
                onClick={() => nudgeBy(l.step)}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  strokeLinejoin="round" d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      <div className="ts-tiles">
        {tiles.map((t) => (
          <Tile key={t.label} icon={t.icon} label={t.label}
                value={t.value} unit={t.unit} state={t.state} />
        ))}
      </div>

      {/* No refusal line. Applying a value the site does not want is allowed
          now — the corridor test is what tells the learner it was wrong, and
          it does that by showing them, on the road, before it says so. */}

      <button id={step.applyId} type="button" className="ts-apply" onClick={onApply}>
        Apply Setting
      </button>
    </div>
  )
}
