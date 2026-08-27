import { useEffect, useRef, useState } from 'react'
import { urlFor } from '../lib/assetManifest'

/**
 * PAGE 02 — Mission Briefing.
 *
 * The assignment, without turning the page into a text-heavy briefing. It
 * replaces the typed dispatcher monologue: that version ran a character clock
 * for about seven seconds and then handed over on its own, and the redesign
 * gives both the pace and the handover to the learner. Six lines of copy on
 * one glass sheet say the same thing in the time it takes to read them.
 *
 * The environment stays full-screen behind the sheet and is only softened —
 * it is the site the learner is about to work on, and the glass is secondary
 * to it. Nothing here may grow into a card stack or a metric row.
 *
 * P2 is already warming: App starts that band the moment Page 01 hands over,
 * so the seconds spent reading this are seconds the model was going to need.
 */
export default function Page02MissionBriefing({ reducedMotion, onBegin }) {
  const [shown, setShown] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const done = useRef(false)

  useEffect(() => {
    const t = setTimeout(() => setShown(true), 60)
    return () => clearTimeout(t)
  }, [])

  const begin = () => {
    if (done.current) return
    done.current = true
    if (reducedMotion) { onBegin(); return }
    // Fade the sheet out before handing over. A hard swap into the site is the
    // blank frame this sequence exists to avoid.
    setLeaving(true)
    setTimeout(onBegin, 320)
  }

  return (
    <section
      className={`fm-page p02${shown ? ' is-shown' : ''}${leaving ? ' is-leaving' : ''}`}
      aria-label="Field assignment"
    >
      <img className="fm-media fm-media--soft" src={urlFor('iso-background')} alt="" />

      <div className="fm-glass p02-sheet">
        <p className="fm-eyebrow p02-eyebrow">
          <span className="p02-mark" aria-hidden="true" />
          Field assignment
        </p>

        <h1 className="p02-site">Awolowo Way</h1>
        <p className="p02-place">Ikeja · Lagos</p>

        <hr className="p02-rule" />

        <p className="p02-task">Install and commission one LP12 small-cell antenna.</p>
        <p className="p02-note">
          Replacement goes on the lighting column on the central median.
        </p>

        <button className="fm-btn fm-btn--trailing p02-cta" type="button" onClick={begin}>
          Begin
          <span className="fm-btn-arrow" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
                    strokeLinejoin="round" d="M4 12h15m-6-6 6 6-6 6" />
            </svg>
          </span>
        </button>
      </div>
    </section>
  )
}
