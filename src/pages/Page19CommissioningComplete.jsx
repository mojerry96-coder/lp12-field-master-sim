import { useEffect, useState } from 'react'
import { useSim } from '../store'
import { urlFor } from '../lib/assetManifest'

/**
 * PAGE 19 — Commissioning Complete.
 *
 * The final state, and the specification's requirement for it is negative:
 * "remove all build/tuning controls". So the site is the whole screen and one
 * glass panel carries the only two things left to do — look at what happened,
 * or go again.
 *
 * The score is read from the frozen snapshot rather than from live state.
 * `finish()` takes that snapshot precisely so this page and the review cannot
 * disagree with each other, or with a restart that is about to clear
 * everything behind them.
 */
export default function Page19CommissioningComplete({ onReview, onRestart }) {
  const result = useSim((s) => s.result)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setShown(true), 120)
    return () => clearTimeout(t)
  }, [])

  const score = typeof result?.score === 'number' ? result.score : null
  const passMark = result?.passMark ?? 70
  const passed = score === null || score >= passMark

  return (
    <section className={`fm-page p19${shown ? ' is-shown' : ''}`}
             aria-label="Commissioning complete">
      {/* The site, wide, with the commissioned hardware sharp on the right.
          The hero plate is a tall crop — full-bleeding it into a landscape
          frame throws away the street it is standing in — so it takes the same
          masked right-hand treatment Page 01 gives it, over the aerial. */}
      <img className="fm-media fm-media--soft" src={urlFor('iso-background')} alt="" />
      <img className="p19-hero" src={urlFor('welcome-hero')}
           alt="The commissioned LP12 on its column above Awolowo Way" />
      <div className="p19-wash" aria-hidden="true" />

      <div className="fm-glass p19-panel">
        <p className="p19-brand">
          <span className="p19-mark" aria-hidden="true" />
          MIVA OPEN UNIVERSITY
        </p>

        <h1 className="p19-title"><span>Commissioning</span> <span>complete</span></h1>

        <p className="fm-eyebrow p19-score-label">Final score</p>
        <div className="p19-score">
          <strong>{score ?? '—'}</strong>
          <span className={`p19-seal${passed ? ' is-pass' : ''}`} aria-hidden="true">
            {passed ? (
              <svg viewBox="0 0 24 24" width="30" height="30">
                <path fill="none" stroke="currentColor" strokeWidth="2.6"
                      strokeLinecap="round" strokeLinejoin="round"
                      d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="30" height="30">
                <path fill="none" stroke="currentColor" strokeWidth="2.6"
                      strokeLinecap="round" d="M12 6.5v7M12 17.4v.2" />
              </svg>
            )}
          </span>
          {/* The number alone does not say whether it was enough. */}
          <span className="sr-live">
            {score === null ? '' : `${score} out of 100, pass mark ${passMark}`}
          </span>
        </div>

        <p className="p19-where">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0
                     9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
          </svg>
          Awolowo Way · LP12
        </p>

        <div className="p19-actions">
          <button className="fm-btn p19-action" type="button" onClick={onReview}>
            <span className="fm-btn-glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <rect x="4" y="13" width="4" height="7" rx="1" fill="currentColor" />
                <rect x="10" y="8" width="4" height="12" rx="1" fill="currentColor" />
                <rect x="16" y="4" width="4" height="16" rx="1" fill="currentColor" />
              </svg>
            </span>
            Review Performance
          </button>

          <button className="fm-btn p19-action p19-restart" type="button" onClick={onRestart}>
            <span className="fm-btn-glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4" />
              </svg>
            </span>
            Restart
          </button>
        </div>
      </div>
    </section>
  )
}
