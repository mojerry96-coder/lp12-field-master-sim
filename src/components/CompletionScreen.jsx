import { useEffect, useMemo, useState } from 'react'
import { useSim } from '../store'
import { urlFor } from '../lib/assetManifest'

/**
 * The end of the simulation, and unmistakably so.
 *
 * The previous ending was another installation page with the controls still on
 * it, so nothing told the learner the activity had finished. This is a
 * dedicated full-screen state: the completed environment is the picture, the
 * interface supports it, and every progression control is gone.
 *
 * Nothing here is invented. Every figure comes from state the simulation
 * already recorded — the installed flag, the height and downtilt checks, the
 * wrong-part count, the elapsed time. Where a value was never calculated it is
 * not shown, because a completion screen that reports a measurement nobody
 * took is worse than one that reports less.
 *
 * The success message is likewise gated on the recorded outcome. A learner who
 * finished with the antenna at the wrong downtilt is told so.
 */

const SUCCESS_COPY = 'Excellent work. You assembled the LP12 installation, '
  + 'configured the network coverage and completed the handover test.'
const PARTIAL_COPY = 'Simulation complete. Review your installation and tuning '
  + 'decisions, then try again to improve network coverage and handover stability.'

function formatDuration(ms) {
  if (!ms || ms < 0) return null
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

export default function CompletionScreen({ onReview, onRestart, onReturnToCourse }) {
  const result = useSim((s) => s.result)
  const [swept, setSwept] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setSwept(true), 120)
    return () => clearTimeout(t)
  }, [])

  const rows = useMemo(() => {
    if (!result) return []
    // Only what the simulation actually recorded.
    const out = [
      { k: 'LP12 installation', v: result.installed ? 'Complete' : 'Incomplete',
        ok: result.installed },
      { k: 'Coverage', v: result.heightOk && result.tiltOk ? 'Within target' : 'Outside target',
        ok: result.heightOk && result.tiltOk },
      { k: 'Mount height', v: `${result.height} m`, ok: result.heightOk },
      { k: 'Downtilt', v: `${result.downtilt}°`, ok: result.tiltOk },
    ]
    if (result.networkTest) {
      out.push({ k: 'Corridor test',
                 v: result.networkTest.overall === 'good' ? 'Passed' : 'Review',
                 ok: result.networkTest.overall === 'good' })
    }
    if (typeof result.wrongAttempts === 'number') {
      // Wrong drags are scored, so the row shows what they cost rather than
      // only how many there were.
      const lost = result.wrongAttemptPenalty
      out.push({ k: 'Incorrect part attempts',
                 v: lost ? `${result.wrongAttempts} (−${lost})` : String(result.wrongAttempts),
                 ok: result.wrongAttempts === 0 })
    }
    const dur = formatDuration(result.durationMs)
    if (dur) out.push({ k: 'Completion time', v: dur, ok: true })
    return out
  }, [result])

  const score = typeof result?.score === 'number' ? result.score : null
  const passMark = result?.passMark ?? 70
  const passed = Boolean(result?.installed && result?.heightOk && result?.tiltOk
    && (score === null || score >= passMark))

  return (
    <div className={`completion${swept ? ' is-swept' : ''}`}>
      {/* The completed site is the dominant visual: the finished pole standing
          in its own environment, with the coverage it produced. */}
      <img className="completion-plate" src={urlFor('iso-background')} alt="" aria-hidden="true" />
      <div className="completion-dome" aria-hidden="true" />
      <div className="completion-sweep" aria-hidden="true" />
      <div className="completion-scrim" aria-hidden="true" />

      <section className="completion-panel" role="region" aria-label="Simulation complete">
        <p className={`completion-mark${passed ? ' is-pass' : ''}`} aria-hidden="true">
          {passed ? '✓' : '!'}
        </p>
        <h1 className="completion-title">SIMULATION COMPLETE</h1>
        <p className="completion-lead">
          LP12 installation and network optimisation completed
        </p>
        <p className="completion-copy">{passed ? SUCCESS_COPY : PARTIAL_COPY}</p>

        {score !== null && (
          <div className={`completion-score${score >= passMark ? ' is-pass' : ''}`}>
            <b>{score}<i>/100</i></b>
            <span>{score >= passMark ? 'Pass' : 'Below pass'} — pass mark {passMark}</span>
          </div>
        )}


        {rows.length > 0 && (
          <dl className="completion-stats">
            {rows.map((r) => (
              <div key={r.k} className={r.ok ? 'is-ok' : 'is-warn'}>
                <dt>{r.k}</dt>
                <dd>{r.v}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="completion-actions">
          <button type="button" className="is-primary cursor-target" onClick={onReview}>
            Review Your Performance
          </button>
          <button type="button" className="cursor-target" onClick={onRestart}>
            Restart Simulation
          </button>
          {/* Only when a real destination exists — never a placeholder route. */}
          {onReturnToCourse && (
            <button type="button" className="cursor-target" onClick={onReturnToCourse}>
              Return to Course
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

/** The review, built from the same recorded result. */
export function PerformanceReview({ onClose }) {
  const result = useSim((s) => s.result)
  if (!result) return null

  const steps = result.completedStages ?? []
  const t = result.tuning
  const tOk = result.tuningOk ?? {}

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

  const notes = []
  if (!result.heightOk) notes.push('Mount height was outside the 7–8 m target for this site.')
  if (!result.tiltOk) notes.push('Downtilt did not reach the 5° the site requires.')
  if (t && !tOk.interval) {
    notes.push('Measurement interval was off target — sampling too slowly misses '
      + 'the handover moment, too quickly spends battery for no extra confidence.')
  }
  if (t && !tOk.hysteresis) {
    notes.push('Hysteresis was off target — too narrow a margin ping-pongs at the '
      + 'cell boundary, too wide a margin holds a weakening cell.')
  }
  if (t && !tOk.timeToTrigger) {
    notes.push('Time-to-trigger was off target — firing early makes handovers fail '
      + 'on brief fades, firing late breaks the call before the phone moves.')
  }
  if (result.wrongAttempts > 0) {
    notes.push(`${result.wrongAttempts} part(s) were fitted out of order — components `
      + 'must go on in sequence: bands, rail, pivot, antenna, fasteners, connectors.')
  }
  if (!notes.length) {
    notes.push('No issues recorded. Installation order, mount height, downtilt and '
      + 'all three reporter settings were correct.')
  }

  return (
    <div className="review-sheet" role="dialog" aria-label="Performance review">
      <div className="review-inner">
        <h2>Performance review</h2>

        {typeof result.score === 'number' && (
          <>
            <h3>Score</h3>
            <ul className="review-deductions">
              <li><span>Starting score</span><span>100</span></li>
              {(result.penalties ?? []).map((p) => (
                <li key={p.k}><span>{p.k}</span><b>−{p.points}</b></li>
              ))}
              <li className="is-total">
                <span>Final score</span><span>{result.score}/100</span>
              </li>
            </ul>
          </>
        )}


        <h3>Installation steps completed</h3>
        <ul className="review-steps">
          {steps.length
            ? steps.map((s) => <li key={s}><i aria-hidden="true">✓</i>{s}</li>)
            : <li>No steps recorded.</li>}
        </ul>

        {/* All five, because all five are now the learner's own call and all
            five are scored. Listing only the two made on the pole was honest
            while the reporter steps refused anything but the target value —
            there was nothing to report. There is now. */}
        <h3>Tuning decisions</h3>
        <ul className="review-steps">
          {decisions.map((d) => (
            <li key={d.k} className={d.ok ? '' : 'is-warn'}>{d.k} {d.v}</li>
          ))}
        </ul>

        {result.networkTest && (
          <>
            <h3>Corridor test</h3>
            <ul className="review-steps">
              <li className={result.networkTest.overall === 'good' ? '' : 'is-warn'}>
                {result.networkTest.overall === 'good'
                  ? 'Passed — the link held for the length of the corridor.'
                  : 'Reviewed — the link did not hold for the length of the corridor.'}
              </li>
            </ul>
          </>
        )}

        <h3>Recommended improvements</h3>
        <ul className="review-notes">{notes.map((n) => <li key={n}>{n}</li>)}</ul>

        <button type="button" className="is-primary cursor-target" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
