import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NetworkTestViewport, { TEST_DURATION_MS } from './NetworkTestViewport'
import { buildResult, reviewDecisions, verdictLabel } from './networkTestQuality'

/**
 * NETWORK TEST — between Time-to-Trigger and Reporter Optimised.
 *
 * The learner has made five decisions and been told nothing about any of them.
 * This page runs those decisions down the real corridor and lets them watch
 * what happens: "the learner should see their network work — or fail — before
 * the simulation tells them why."
 *
 * Almost all of the teaching is in the 3D layer. The UI is three small glass
 * surfaces and no paragraphs, because the animation is the explanation and a
 * dashboard beside it would just be the answer in text.
 *
 * The page never advances itself. Continue stays disabled until the test
 * finishes and then waits for the learner (sections 27 and 54).
 *
 * Nothing earlier in the simulation refuses a value any more. Mount height,
 * downtilt and all three reporter settings are accepted as chosen, and this is
 * the first and only place the learner is told whether those choices work. So
 * when the corridor faults something, the debrief has to do two jobs: say
 * which decision caused it and why, and offer the way back to that one
 * control. Continue is never blocked — a learner who would rather carry the
 * result than rework it is allowed to, and the score reflects it.
 */

/* The four rows resolve while the probe travels rather than all at the end, so
   the panel reads as measurement rather than as a verdict appearing from
   nowhere. Coverage settles first because it is the first thing the corridor
   demonstrates. */
const ROW_RESOLVES_AT = { coverage: 0.42, stability: 0.68, interruption: 0.86 }

function TowerGlyph() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 34V22" />
      <path d="M17 27C17 22.8 20.2 19.5 24 19.5C27.8 19.5 31 22.8 31 27" />
      <path d="M11 29C11 21.6 16.8 15.8 24 15.8C31.2 15.8 37 21.6 37 29" />
      <circle cx="24" cy="36" r="2.4" />
    </svg>
  )
}

const ROW_ICONS = {
  coverage: (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <rect x="3" y="15" width="3" height="6" rx="1" />
      <rect x="9" y="11" width="3" height="10" rx="1" />
      <rect x="15" y="6" width="3" height="15" rx="1" />
    </svg>
  ),
  stability: (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M2 12h4l3-7 4 14 3-7h6" fill="none" stroke="currentColor"
            strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  interruption: (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="M7 17 17 7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  ),
  result: (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="M8 12.4l2.6 2.6L16 9.6" fill="none" stroke="currentColor"
            strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

/* Colour is never the only carrier (section 55): every row states its status
   in words to assistive tech, and the icons differ in shape. */
const STATE_WORD = {
  testing: 'testing', good: 'good', warning: 'marginal', failed: 'failed',
}

function ResultRow({ label, state, icon, final, verdict }) {
  return (
    <div className={`result-row${final ? ' result-row--final' : ''} is-${state}`}>
      <span>{label}</span>
      <div className="result-row__status">
        {final && verdict && <b className="result-row__verdict">{verdict}</b>}
        <i aria-hidden="true" />
        <span className="result-row__icon" aria-hidden="true">{ROW_ICONS[icon]}</span>
        <span className="sr-live">{`${label}: ${STATE_WORD[state]}`}</span>
      </div>
    </div>
  )
}

const STATE_LABEL = { good: 'Correct', near: 'Close', off: 'Needs review' }

function DecisionRow({ decision, onAdjust }) {
  const { label, value, unit, state, note } = decision
  return (
    <li className={`debrief-row is-${state}`}>
      <div className="debrief-row__head">
        <span className="debrief-row__label">{label}</span>
        <span className="debrief-row__value">
          {value}<small>{unit}</small>
        </span>
        <span className="debrief-row__state">{STATE_LABEL[state]}</span>
      </div>
      {note && <p className="debrief-row__note">{note}</p>}
      {state !== 'good' && onAdjust && (
        <button
          type="button"
          className="debrief-row__adjust"
          onClick={() => onAdjust(decision.revisit)}
        >
          Adjust {label.toLowerCase()}
        </button>
      )}
    </li>
  )
}

export default function NetworkTestPage({ settings, onContinue, onAdjust, onResult }) {
  const [phase, setPhase] = useState('intro')
  const [progress, setProgress] = useState(0)

  // Computed once from the values the learner actually left behind. Nothing
  // here writes back to them (section 52).
  const outcome = useMemo(() => buildResult(settings), [settings])
  const decisions = useMemo(() => reviewDecisions(settings), [settings])
  const faults = useMemo(() => decisions.filter((d) => d.state !== 'good'), [decisions])

  useEffect(() => {
    const t = setTimeout(() => setPhase('testing'), 650)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (phase !== 'testing') return undefined
    const started = performance.now()
    let frame = 0
    const update = (now) => {
      const next = Math.min((now - started) / TEST_DURATION_MS, 1)
      setProgress(next)
      if (next < 1) {
        frame = requestAnimationFrame(update)
      } else {
        setPhase('complete')
      }
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [phase])

  const complete = phase === 'complete'

  // Handed up so the score and the end-of-run review can quote the same
  // verdict the learner just watched, rather than recomputing it later and
  // risking a different answer.
  //
  // Reported once per run. The parent writes this to the store, and a store
  // write re-renders this component — so an effect that reports on every pass
  // is one unstable dependency away from an update loop.
  const reported = useRef(false)
  useEffect(() => {
    if (!complete || reported.current) return
    reported.current = true
    onResult?.({ ...outcome, faults: faults.map((f) => f.key) })
  }, [complete, outcome, faults, onResult])

  // A row shows its real state only once the probe has covered the ground that
  // measures it; until then it is still testing.
  const rowState = useCallback((key) => (
    progress >= ROW_RESOLVES_AT[key] ? outcome[key] : 'testing'
  ), [progress, outcome])

  return (
    <main className="network-test-page">
      <NetworkTestViewport settings={settings} progress={progress} />

      <section className="network-test-title network-glass">
        <div className="network-test-title__icon">
          <TowerGlyph />
          <span className="network-test-title__status" />
        </div>
        <div>
          <h1>Network Test</h1>
          <p>Live corridor test</p>
        </div>
      </section>

      <aside className="live-result-panel network-glass" aria-label="Live test result">
        <ResultRow label="Coverage" state={rowState('coverage')} icon="coverage" />
        <ResultRow label="Stability" state={rowState('stability')} icon="stability" />
        <ResultRow label="Interruption" state={rowState('interruption')} icon="interruption" />
        <ResultRow
          label="Result"
          state={complete ? outcome.overall : 'testing'}
          icon="result"
          final
          verdict={complete ? verdictLabel(outcome.overall) : null}
        />
      </aside>

      {complete && (
        <section className="network-debrief network-glass" aria-label="Test debrief">
          <header className="network-debrief__head">
            <h2>{faults.length === 0 ? 'Corridor test passed'
              : 'The corridor found problems'}</h2>
            <p>
              {faults.length === 0
                ? 'Every decision holds up under load. The cell is ready to commission.'
                : `${faults.length} of your five decisions did not hold up. Adjust them `
                  + 'and run the corridor again, or commission the cell as it stands.'}
            </p>
          </header>

          <ul className="network-debrief__list">
            {decisions.map((d) => (
              <DecisionRow key={d.key} decision={d} onAdjust={onAdjust} />
            ))}
          </ul>
        </section>
      )}

      <section className="network-test-progress network-glass">
        <div className={`network-test-progress__wave${complete ? '' : ' is-active'}`}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path d="M2 12h3.5l2.5-6 3.5 12 2.5-6H22" fill="none" stroke="currentColor"
                  strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div
          className="network-test-progress__track"
          role="progressbar"
          aria-label="Network test progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <div className="network-test-progress__fill"
               style={{ transform: `scaleX(${progress})` }} />
          <span className="network-test-progress__probe"
                style={{ left: `${progress * 100}%` }} />
        </div>

        <button
          type="button"
          className="network-test-progress__action"
          disabled={!complete}
          onClick={onContinue}
          aria-label={!complete ? 'Network test running'
            : faults.length ? 'Commission the cell as it stands'
            : 'Continue to commissioning'}
        >
          {complete ? (
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.7" />
              <circle cx="12" cy="12" r="2.6" fill="currentColor" />
            </svg>
          )}
        </button>
      </section>

      <p className="sr-live" aria-live="polite">
        {complete ? `Network test complete. Result ${verdictLabel(outcome.overall)}.` : ''}
      </p>
    </main>
  )
}
