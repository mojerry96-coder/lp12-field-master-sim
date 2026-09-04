import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Rotary downtilt control.
 *
 * Downtilt is an angle set by turning a bolt against a scale on the bracket, so
 * a row of preset buttons was the wrong instrument for it — it taught the value
 * without teaching the gesture. This turns.
 *
 * Two parts, deliberately:
 *
 *   the knob      inline in the panel, where the control belongs
 *   the dial      a tick scale that slides in from the edge of the page while
 *                 the knob is turning, and retracts when it settles
 *
 * The dial is the reason the knob can stay small. A knob has to be big to carry
 * a legible scale around its own rim; moving the scale off the knob and onto
 * the page edge means the numbers can be large enough to read while the knob
 * stays the size the panel has room for.
 *
 * Values snap to whole degrees. tiltOk() tests `downtilt === downtilt_correct`
 * — an exact match — so a continuous knob would leave the learner a fraction of
 * a degree from correct with no way to see why it was not accepted.
 */

const SWEEP = 270            // degrees of knob travel across the whole range
const SNAP = 1               // whole degrees, see above

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)) }

export default function DowntiltKnob({ value, min = 0, max = 10, target,
                                       disabled, onChange }) {
  const knobRef = useRef(null)
  const [turning, setTurning] = useState(false)
  const settle = useRef(0)

  const span = max - min
  const frac = span > 0 ? (value - min) / span : 0
  const angle = -SWEEP / 2 + frac * SWEEP

  // Hold the dial out for a moment after the last change, so a small
  // adjustment does not make it flick in and straight back out again.
  const bump = useCallback(() => {
    setTurning(true)
    clearTimeout(settle.current)
    settle.current = setTimeout(() => setTurning(false), 900)
  }, [])

  useEffect(() => () => clearTimeout(settle.current), [])

  const apply = useCallback((next) => {
    const snapped = clamp(Math.round(next / SNAP) * SNAP, min, max)
    if (snapped !== value) onChange(snapped)
    bump()
  }, [min, max, value, onChange, bump])

  const fromPointer = useCallback((e) => {
    const el = knobRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    // Screen y grows downward; negate so a clockwise drag increases the angle.
    let deg = Math.atan2(dx, -dy) * (180 / Math.PI)
    deg = clamp(deg, -SWEEP / 2, SWEEP / 2)
    apply(min + ((deg + SWEEP / 2) / SWEEP) * span)
  }, [apply, min, span])

  const onPointerDown = useCallback((e) => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    fromPointer(e)
  }, [disabled, fromPointer])

  const onPointerMove = useCallback((e) => {
    if (disabled || !e.currentTarget.hasPointerCapture?.(e.pointerId)) return
    fromPointer(e)
  }, [disabled, fromPointer])

  const onKeyDown = useCallback((e) => {
    if (disabled) return
    const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? SNAP
      : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -SNAP : 0
    if (!d) return
    e.preventDefault()
    apply(value + d)
  }, [disabled, value, apply])

  // Two rings: a dense fine ring every 0.25° of value for texture, and the
  // labelled majors. Only whole degrees are selectable — the fine ring is
  // there to make the scale read like a tuner, not to offer finer stops.
  const fine = []
  for (let v = min; v <= max + 1e-6; v += 0.25) {
    const t = span > 0 ? (v - min) / span : 0
    fine.push({ v, deg: -SWEEP / 2 + t * SWEEP })
  }
  const ticks = []
  for (let v = min; v <= max; v += SNAP) {
    const t = span > 0 ? (v - min) / span : 0
    ticks.push({ v, deg: -SWEEP / 2 + t * SWEEP, major: v % 2 === 0 })
  }

  const onTarget = value === target
  const shown = String(Math.abs(Math.round(value))).padStart(2, '0')

  return (
    <>
      {/* Scale, parked off the right edge of the page until the knob moves. */}
      <div className={`tilt-dial${turning ? ' is-out' : ''}`} aria-hidden="true">
        <div className="tilt-dial-face" style={{ transform: `rotate(${-angle}deg)` }}>
          {fine.map((t) => (
            <div key={`f${t.v}`} className="tilt-dial-fine"
                 style={{ transform: `rotate(${t.deg}deg)` }} />
          ))}
          {ticks.map((t) => (
            <div key={t.v} className={`tilt-dial-tick${t.major ? ' is-major' : ''}`}
                 style={{ transform: `rotate(${t.deg}deg)` }}>
              <i />
              {t.major && <span style={{ transform: `rotate(${-t.deg + angle}deg)` }}>{t.v}</span>}
            </div>
          ))}
        </div>
        <div className="tilt-dial-marker" />
        <div className="tilt-dial-window">
          <i /><i /><i />
        </div>

        {/* Reference-style value block: dimmed leading digit, bright value. */}
        <div className="tilt-dial-readout">
          <span className="tilt-dial-label">Downtilt<em>ANGLE</em></span>
          <b><u>{shown[0]}</u>{shown.slice(1)}<sup>°</sup></b>
          <span className={`tilt-dial-state${onTarget ? ' is-ok' : ''}`}>
            SET <em>TARGET {target}°</em>
          </span>
        </div>
      </div>

      <div className="panel-control tilt-knob-control">
        <label id="downtilt-knob-label">Downtilt</label>
        <div className="tilt-knob-row">
          <div
            ref={knobRef}
            className={`tilt-knob cursor-target${disabled ? ' is-disabled' : ''}`
                       + (turning ? ' is-turning' : '')}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-labelledby="downtilt-knob-label"
            aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
            aria-valuetext={`${value} degrees`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
            onKeyDown={onKeyDown}
          >
            <span className="tilt-knob-collar" aria-hidden="true">
              <span className="tilt-knob-icon">
                <span><i /></span>
                <span><i /><i /><i /></span>
                <span><i /><i /><i /><i /><i /></span>
              </span>
            </span>
            <span className="tilt-knob-body" style={{ transform: `rotate(${angle}deg)` }}>
              <i className="tilt-knob-pill" />
            </span>
          </div>

          <div className="tilt-knob-readout">
            <b className={onTarget ? 'is-ok' : 'is-warn'}>{value}<sup>°</sup></b>
            <span>{onTarget ? 'within target' : `target ${target}°`}</span>
          </div>
        </div>
      </div>
    </>
  )
}

