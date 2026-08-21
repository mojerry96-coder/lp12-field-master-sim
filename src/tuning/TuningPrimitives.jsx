import { useCallback, useId, useMemo, useRef } from 'react'

/**
 * Shared bento primitives for the tuning pages.
 *
 * Every chart here is drawn from a seeded generator rather than Math.random, so
 * a card looks identical on every render and between page visits. A sparkline
 * that reshuffles whenever React re-renders reads as live telemetry changing on
 * its own, which would be a lie — these are fixed sample windows.
 */

export function BentoCard({ className = '', children }) {
  return <article className={`lp12-card ${className}`}>{children}</article>
}

/**
 * Arc slider, used for time-to-trigger.
 *
 * The reference draws this one control on a curve rather than a straight track,
 * which is a real distinction and not decoration: the other two values are
 * bounded settings, while time-to-trigger is a delay being dialled around a
 * sweet spot, and the arc puts that sweet spot at the top of the curve.
 *
 * Pointer input maps the horizontal position across the arc rather than the
 * angle to the cursor. The curve is shallow, so horizontal travel is what a
 * dragging finger or mouse actually produces; angle-mapping a shallow arc makes
 * the handle jump when the pointer strays above or below it. Keyboard and
 * assistive technology go through the ARIA slider contract, so the control is
 * fully operable without ever touching the curve.
 */
export function ArcSlider({ label, value, min, max, step, target, unit, onChange, nudge = false }) {
  const id = useId()
  const svgRef = useRef(null)
  const dragging = useRef(false)

  const W = 300
  const H = 96
  const X0 = 22
  const X1 = W - 22
  const BASE = 78
  const LIFT = 34            // control-point height of the quadratic curve

  const t = (value - min) / (max - min)

  // Quadratic Bézier from (X0,BASE) to (X1,BASE) with the peak in the middle.
  const pointAt = (u) => {
    const mt = 1 - u
    return {
      x: mt * mt * X0 + 2 * mt * u * ((X0 + X1) / 2) + u * u * X1,
      y: mt * mt * BASE + 2 * mt * u * (BASE - LIFT * 2) + u * u * BASE,
    }
  }
  const path = `M ${X0} ${BASE} Q ${(X0 + X1) / 2} ${BASE - LIFT * 2} ${X1} ${BASE}`
  const handle = pointAt(t)

  const snap = useCallback(
    (raw) => snapToTarget(raw, { min, max, step, target }),
    [min, max, step, target],
  )
  const onTarget = target !== undefined && value === target

  const fromClientX = useCallback((clientX) => {
    const rect = svgRef.current.getBoundingClientRect()
    const u = ((clientX - rect.left) / rect.width * W - X0) / (X1 - X0)
    return snap(min + Math.min(Math.max(u, 0), 1) * (max - min))
  }, [min, max, snap])

  const onPointerDown = (e) => {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    onChange(fromClientX(e.clientX))
  }
  const onPointerMove = (e) => {
    if (dragging.current) onChange(fromClientX(e.clientX))
  }
  const endDrag = (e) => {
    dragging.current = false
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const onKeyDown = (e) => {
    const big = step * 4
    const map = {
      ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step,
      PageUp: big, PageDown: -big,
    }
    if (e.key === 'Home') { e.preventDefault(); return onChange(min) }
    if (e.key === 'End') { e.preventDefault(); return onChange(max) }
    if (map[e.key] === undefined) return undefined
    e.preventDefault()
    return onChange(snap(value + map[e.key]))
  }

  return (
    <div className="lp12-slider-block">
      <span id={`${id}-label`} className="lp12-card-eyebrow">{label}</span>
      <div className={`lp12-primary-value${onTarget ? ' is-on-target' : ''}`}>
        {value}
        <span>{unit}</span>
      </div>

      <div className={`lp12-arc-row${nudge ? ' is-nudge' : ''}`}>
        <span>{min}</span>
        <svg
          ref={svgRef}
          className="lp12-arc"
          viewBox={`0 0 ${W} ${H}`}
          role="slider"
          tabIndex={0}
          aria-labelledby={`${id}-label`}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={`${value} ${unit}${onTarget ? ', on target' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
        >
          <path d={path} className="lp12-arc-track" />
          {/* pathLength normalises the curve to 1 so the dash pattern below is a
              plain fraction of the track. It has to be an attribute — it is not
              a CSS property, and setting it through `style` silently does
              nothing, leaving the fill drawn full-length at every value. */}
          <path d={path} className="lp12-arc-fill" pathLength={1}
                strokeDasharray={1} strokeDashoffset={1 - t} />
          {target !== undefined && (() => {
            const p = pointAt((target - min) / (max - min))
            return <circle cx={p.x} cy={p.y} r="4" className="lp12-arc-target" />
          })()}
          <circle cx={handle.x} cy={handle.y} r="9"
                  className={`lp12-arc-handle${onTarget ? ' is-hit' : ''}`} />
          <text x={handle.x} y={BASE + 16} className="lp12-arc-readout"
                textAnchor="middle">{value}</text>
        </svg>
        <span>{max}</span>
      </div>
      {target !== undefined && (
        <p className={`lp12-target-note${onTarget ? ' is-hit' : ''}`}>
          {onTarget ? `On target · ${value} ${unit}` : `Target ${target} ${unit}`}
        </p>
      )}
    </div>
  )
}

/** Deterministic pseudo-noise; same seed always yields the same trace. */
function seeded(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

/**
 * Snaps a raw slider value onto the target when it lands close enough.
 *
 * Every one of these controls accepts a single exact value — the interval has
 * 161 positions and only 128 is correct — so without a detent the learner is
 * hunting for one pixel of travel with no way of knowing where it is. The
 * detent does not widen what counts as correct: the value that gets confirmed
 * is still exactly the target, it is just possible to reach it by dragging.
 */
export function snapToTarget(raw, { min, max, step, target }) {
  const clamped = Math.min(Math.max(raw, min), max)
  const detent = step * 3
  if (target !== undefined && Math.abs(clamped - target) <= detent) return target
  // Re-quantise off the minimum so fractional steps (0.1 dB) stay exact.
  return Math.round((clamped - min) / step) * step + min
}

export function TuningSlider({
  label, value, min, max, step, target, unit, onChange, nudge = false, displayValue,
}) {
  const id = useId()
  const span = max - min
  const progress = ((value - min) / span) * 100
  const targetPercent = target === undefined ? null : ((target - min) / span) * 100
  const onTarget = target !== undefined && value === target

  return (
    <div className="lp12-slider-block">
      <label id={`${id}-label`} htmlFor={id} className="lp12-card-eyebrow">{label}</label>
      <div className={`lp12-primary-value${onTarget ? ' is-on-target' : ''}`}>
        {displayValue ?? value}
        <span>{unit}</span>
      </div>
      <div className={`lp12-range-row${nudge ? ' is-nudge' : ''}`}>
        <span>{min}</span>
        <div className="lp12-range-track">
          {/* The target has to be visible on the track. Nothing else in the
              card tells the learner which of 161 positions is the right one. */}
          {targetPercent !== null && (
            <span className={`lp12-range-target${onTarget ? ' is-hit' : ''}`}
                  style={{ left: `${targetPercent}%` }} aria-hidden="true" />
          )}
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-labelledby={`${id}-label`}
            aria-valuetext={`${displayValue ?? value} ${unit}${onTarget ? ', on target' : ''}`}
            style={{ '--range-progress': `${progress}%` }}
            onChange={(e) => onChange(snapToTarget(
              Number(e.currentTarget.value), { min, max, step, target }))}
          />
        </div>
        <span>{max}</span>
      </div>
      {target !== undefined && (
        <p className={`lp12-target-note${onTarget ? ' is-hit' : ''}`}>
          {onTarget ? `On target · ${displayValue ?? value} ${unit}` : `Target ${target} ${unit}`}
        </p>
      )}
    </div>
  )
}

export function ApplyButton({ id, children, onClick }) {
  return (
    <button id={id} type="button" className="lp12-apply-button" onClick={onClick}>
      {children}
    </button>
  )
}

/** Five compact bars, as in the reference's RSRP card. */
export function SignalBars({ active = 5 }) {
  const heights = [10, 16, 22, 28, 34]
  return (
    <div className="lp12-signal-bars" aria-hidden="true">
      {heights.map((h, i) => (
        <i key={h} style={{ height: h }} className={i < active ? '' : 'is-off'} />
      ))}
    </div>
  )
}

export function MetricLine({ label, value }) {
  return (
    <div className="lp12-metric-line">
      <span>{label}</span>
      <span className="lp12-metric-track"><b style={{ width: `${value}%` }} /></span>
      <em>{value}%</em>
    </div>
  )
}

export function ProgressBar({ value, tone = 'blue' }) {
  return (
    <div className={`lp12-progress${tone === 'green' ? ' is-green' : ''}`} aria-hidden="true">
      <b style={{ width: `${value}%` }} />
    </div>
  )
}

export function CircularGauge({ value, tone = 'green', size = 148, caption = 'Excellent' }) {
  const r = (size - 16) / 2
  const c = 2 * Math.PI * r
  const stroke = tone === 'green' ? 'var(--lp12-green)' : 'var(--lp12-blue)'
  return (
    <div className="lp12-gauge" style={{ width: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ccd6e2" strokeWidth="7" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={stroke} strokeWidth="7"
          strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <strong className="lp12-gauge-value">{value}<small>%</small></strong>
      <div className="lp12-gauge-scale"><span>0%</span><span>{caption}</span><span>100%</span></div>
    </div>
  )
}

function polyline(values, w, h, pad = 2) {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  return values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = pad + (1 - (v - lo) / span) * (h - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

/** Single-trace micro-chart with the reference's axis furniture. */
/**
 * @param samples  how many measurements the window actually contains. When
 *   given, it sets the trace's resolution: a short interval packs the same 60
 *   seconds with more, finer detail, a long one leaves a coarse, blocky line.
 *   That is the honest way to show a sampling rate on a chart — the shape of
 *   the signal is unchanged, only how much of it was captured.
 */
export function SampleSparkline({
  seed = 7, axis = ['20', '0', '-20', '-40'], tone = 'blue', height = 108, samples, crossings,
}) {
  const pts = useMemo(() => {
    const rnd = seeded(seed)
    // The underlying signal is fixed; sampling only decides how finely it is
    // read, so the walk is always generated at full resolution and then
    // decimated. Regenerating it at a different length would redraw the world.
    const full = []
    let v = 0.5
    for (let i = 0; i < 192; i++) { v += (rnd() - 0.5) * 0.14; full.push(Math.max(0, Math.min(1, v))) }
    // Hysteresis page: the trace is the neighbour's margin over the serving
    // cell, and what matters is how often it crosses the threshold. A wider
    // margin means fewer crossings, which is exactly what stops the ping-pong.
    if (crossings !== undefined) {
      const out = []
      for (let i = 0; i < 48; i++) {
        const wave = Math.sin((i / 48) * crossings * Math.PI * 2)
        out.push(Math.max(0, Math.min(1, 0.5 + wave * 0.34 + (full[i * 4] - 0.5) * 0.22)))
      }
      return out
    }
    if (samples === undefined) return full.filter((_, i) => i % 4 === 0)

    const count = Math.max(6, Math.min(96, Math.round(samples / 8)))
    const out = []
    for (let i = 0; i < count; i++) out.push(full[Math.round((i / (count - 1)) * (full.length - 1))])
    return out
  }, [seed, samples, crossings])
  const stroke = tone === 'green' ? 'var(--lp12-green)' : 'var(--lp12-blue)'

  return (
    <div className="lp12-chart" aria-hidden="true">
      <div className="lp12-chart-frame">
        <div className="lp12-chart-axis" style={{ height }}>
          {axis.map((a) => <span key={a}>{a}</span>)}
        </div>
        <svg viewBox={`0 0 300 ${height}`} width="100%" height={height} preserveAspectRatio="none">
          <polyline points={polyline(pts, 300, height)} fill="none" stroke={stroke} strokeWidth="1.6" />
        </svg>
      </div>
      <div className="lp12-chart-x"><span>0s</span><span>20s</span><span>40s</span><span>60s</span></div>
    </div>
  )
}

/** Two traces, for the Trigger Response card on page 3. */
/**
 * @param triggerAt  0..1, where in the window the handover actually fires.
 *   The two traces are the serving and neighbour cells; a longer
 *   time-to-trigger moves the marker later, which is the whole point of the
 *   control — you are choosing how much evidence to gather before acting.
 */
export function DualSparkline({ height = 108, triggerAt }) {
  const [a, b] = useMemo(() => {
    const mk = (seed, drift) => {
      const rnd = seeded(seed)
      const out = []
      let v = 0.5
      for (let i = 0; i < 48; i++) { v += (rnd() - 0.5) * 0.2 + drift; out.push(Math.max(0, Math.min(1, v))) }
      return out
    }
    return [mk(21, 0.002), mk(44, -0.001)]
  }, [])
  const markerX = triggerAt === undefined ? null : 12 + triggerAt * 276

  return (
    <div className="lp12-chart" aria-hidden="true">
      <div className="lp12-chart-frame">
        <div className="lp12-chart-axis" style={{ height }}>
          <span>-60</span><span>-90</span><span>-120</span><span>-150</span>
        </div>
        <svg viewBox={`0 0 300 ${height}`} width="100%" height={height} preserveAspectRatio="none">
          <polyline points={polyline(a, 300, height)} fill="none" stroke="var(--lp12-green)" strokeWidth="1.6" />
          <polyline points={polyline(b, 300, height)} fill="none" stroke="var(--lp12-blue)" strokeWidth="1.6" />
          {markerX !== null && (
            <line x1={markerX} y1="0" x2={markerX} y2={height}
                  stroke="var(--lp12-ink-3)" strokeWidth="1" strokeDasharray="3 3" />
          )}
        </svg>
      </div>
      <div className="lp12-chart-x"><span>0s</span><span>20s</span><span>40s</span><span>60s</span></div>
    </div>
  )
}

/** Concentric radar with a few cell dots — the Overlap Map on page 2. */
/**
 * @param spread  0..1, how settled the handover boundary is. A stable boundary
 *   keeps the samples in a tight cluster near the centre; an unstable one
 *   scatters them out toward the rim, which is what ping-ponging looks like
 *   when you plot where handovers actually happened.
 */
export function OverlapRadar({ size = 150, spread = 1 }) {
  const c = size / 2
  const scatter = 1 + (1 - spread) * 2.6
  const dots = [
    { dx: -10, dy: -6, r: 4.5, o: 1 },
    { dx: 12, dy: 4, r: 3.5, o: 0.7 },
    { dx: 2, dy: 16, r: 3, o: 0.5 },
  ]
  return (
    <div className="lp12-gauge" style={{ width: size, marginTop: 8 }}>
      <svg width={size} height={size} aria-hidden="true">
        {[0.3, 0.6, 0.92].map((k) => (
          <circle key={k} cx={c} cy={c} r={c * k} fill="none" stroke="var(--lp12-hairline)" strokeWidth="1" />
        ))}
        <circle cx={c} cy={c} r={c * 0.45 * (0.6 + spread * 0.4)} fill="rgba(47,110,219,.10)" />
        {dots.map((d) => (
          <circle key={`${d.dx},${d.dy}`}
                  cx={c + d.dx * scatter} cy={c + d.dy * scatter}
                  r={d.r} fill="var(--lp12-blue)" opacity={d.o} />
        ))}
      </svg>
    </div>
  )
}

export function ConfirmedValue({ value, unit, label }) {
  return (
    <div>
      <strong className="lp12-confirmed-value">{value}<small>{unit}</small></strong>
      <span className="lp12-confirmed-label">{label}</span>
    </div>
  )
}
