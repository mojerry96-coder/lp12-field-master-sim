import { useSim } from '../store'
import {
  ArrowRight, BarsIcon, CheckIcon, CheckRing, GearIcon, SignalIcon, WarningIcon,
} from '../reference/RefIcons'
import '../styles/ref-review.css'

/**
 * PAGE 05 in the kit — Performance Review, against `05-performance-review.png`.
 *
 * One large panel at 367/51 measuring 934 x 830, and the kit is emphatic about
 * what goes in it: a 2 x 2 grid — score breakdown, installation steps, final
 * configuration, corridor test result — and NOT the vertical list with a
 * scrollbar this replaces. Everything is visible at once; nothing scrolls.
 *
 * The background is whatever the review opened over, blurred and cooled, which
 * is the kit's "reuse the commissioning environment" — here that is literally
 * Page 04 behind it rather than a second copy of the same art.
 *
 * TWO DEPARTURES FROM THE REFERENCE, both deliberate.
 *
 * The reference's left column carries a "Begin Simulation" pill. That is the
 * landing page's furniture showing through the artist's layer stack; a control
 * that starts the simulation over has no business on a results screen, and the
 * kit's own text says the only main action here is "Try again". So it is not
 * reproduced.
 *
 * The kit's screen is a full page. Ours is a dialog over the completion screen,
 * so it keeps a close control the reference has no need for — without one the
 * learner would have no way back to the page they opened it from.
 */

const CORRIDOR_COPY = {
  good: ['Pass', 'The link held for the length of the corridor.'],
  warning: ['Review', 'The link did not hold for the length of the corridor.'],
  failed: ['Needs adjustment', 'The link broke down before the end of the corridor.'],
}

export default function PerformanceReview({ onClose }) {
  const result = useSim((s) => s.result)
  const restart = useSim((s) => s.restart)
  if (!result) return null

  const steps = result.completedStages ?? []
  const t = result.tuning
  const tOk = result.tuningOk ?? {}
  const passed = typeof result.score === 'number' && result.score >= (result.passMark ?? 70)

  /* Older saved results (v2, before the corridor test) carry no reporter
     values. Their two rows still render; the three new ones are simply absent
     rather than showing as failures the learner never had a chance at. */
  const decisions = [
    { k: 'Mount height', v: `${result.height} m`, ok: result.heightOk },
    { k: 'Downtilt', v: `${result.downtilt}°`, ok: result.tiltOk },
    ...(t ? [
      { k: 'Measurement interval', v: `${t.intervalMs} ms`, ok: tOk.interval },
      { k: 'Hysteresis', v: `${t.hysteresisDb.toFixed(1)} dB`, ok: tOk.hysteresis },
      { k: 'Time-to-trigger', v: `${t.timeToTriggerMs} ms`, ok: tOk.timeToTrigger },
    ] : []),
  ]

  const corridor = result.networkTest
    ? CORRIDOR_COPY[result.networkTest.overall] ?? CORRIDOR_COPY.warning
    : null

  return (
    <div className="fmref revr-layer" role="dialog" aria-label="Performance review">
      <div className="revr-scrim" aria-hidden="true" />

      <section className="fm-glass revr-panel">
        <header className="revr-head">
          <h2>Performance review</h2>
          <div className="revr-score">
            <strong>{result.score ?? '—'}</strong>
            <span>/ 100</span>
            <span className={`fm-chip ${passed ? 'fm-chip-good' : 'fm-chip-review'}`}>
              {passed ? 'Pass' : 'Review'}
            </span>
          </div>
          <button className="revr-close" type="button" onClick={onClose}
                  aria-label="Close performance review">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M6 6 18 18M18 6 6 18" fill="none" stroke="currentColor"
                    strokeWidth="1.9" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="fm-hairline" />

        <div className="revr-grid">
          {/* ---------------------------------------------- score breakdown */}
          <section className="revr-cell">
            <h3><i className="revr-mark"><BarsIcon size={19} /></i>Score breakdown</h3>
            <ul className="revr-rows">
              <li><span>Starting score</span><b>100</b></li>
              {(result.penalties ?? []).map((p) => (
                <li key={p.k}><span>{p.k}</span><b className="is-minus">−{p.points}</b></li>
              ))}
            </ul>
            <div className="fm-hairline revr-total-line" />
            <p className="revr-total">
              <span>Final score</span><b>{result.score}/100</b>
            </p>
          </section>

          {/* --------------------------------------------- steps completed */}
          <section className="revr-cell revr-cell--right">
            <h3><i className="revr-mark"><CheckRing size={19} /></i>Installation steps completed</h3>
            <ul className="revr-steps">
              {steps.length
                ? steps.map((s) => (
                  <li key={s}><i className="revr-tick"><CheckIcon size={20} /></i>{s}</li>
                ))
                : <li className="revr-empty">No steps recorded.</li>}
            </ul>
          </section>

          {/* ----------------------------------------- final configuration */}
          <section className="revr-cell revr-cell--bottom">
            <h3><i className="revr-mark"><GearIcon size={19} /></i>Your final configuration</h3>
            <ul className="revr-config">
              {decisions.map((d) => (
                <li key={d.k}>
                  <span>{d.k}</span>
                  <b>{d.v}</b>
                  <span className={`fm-chip ${d.ok ? 'fm-chip-good' : 'fm-chip-review'}`}>
                    {d.ok ? 'Correct' : 'Needs review'}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* --------------------------------------------- corridor result */}
          <section className="revr-cell revr-cell--bottom revr-cell--right">
            <h3><i className="revr-mark"><SignalIcon size={19} /></i>Corridor test result</h3>
            {corridor ? (
              <div className={`revr-corridor${result.networkTest.overall === 'good' ? ' is-good' : ''}`}>
                <i className="revr-corridor-mark">
                  {result.networkTest.overall === 'good'
                    ? <CheckRing size={22} /> : <WarningIcon size={22} />}
                </i>
                <p><b>{corridor[0]} —</b><br />{corridor[1]}</p>
              </div>
            ) : (
              <p className="revr-empty">The corridor test was not run on this attempt.</p>
            )}
          </section>
        </div>

        <footer className="revr-foot">
          <p className="revr-tagline">Practice today.<br />A more connected tomorrow.</p>
          <button className="fm-btn fm-btn-primary revr-again" type="button" onClick={restart}>
            <span>Try again</span>
            <ArrowRight size={24} />
          </button>
        </footer>
      </section>
    </div>
  )
}
