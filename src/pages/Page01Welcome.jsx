import { useEffect, useRef, useState } from 'react'
import { P1, preload } from '../lib/preloader'
import { urlFor } from '../lib/assetManifest'

/**
 * PAGE 01 — Welcome.
 *
 * The cinematic introduction. Replaces the dark auto-advancing title card: the
 * redesign hands the entry to the learner, so this page holds until Begin
 * Simulation is pressed and exposes no later control.
 *
 * It is still the P1 preload window. The old opener spent three seconds it had
 * to spend anyway; this one spends however long the learner reads, which is
 * strictly better — but it means the handover can now be requested before the
 * assets are decoded. So the button owns both jobs: press it and it either
 * leaves immediately or reports real byte-weighted progress until it can. It
 * never shows a bar that is a timer pretending to be one, and it never drops
 * the learner into an empty briefing.
 *
 * NO LOGO FILE EXISTS IN THIS PROJECT. The wordmark is typographic for the same
 * reason it always was — inventing a mark would put an unapproved one in front
 * of every learner. `.p01-brandmark` is the slot the real asset drops into.
 */

export default function Page01Welcome({ reducedMotion, onBegin }) {
  const [progress, setProgress] = useState(0)
  const [waiting, setWaiting] = useState(false)
  const assetsReady = useRef(false)
  const requested = useRef(false)
  const left = useRef(false)

  // Both the asset gate and the button call this; whichever is second leaves.
  const maybeLeave = useRef(() => {})
  maybeLeave.current = () => {
    if (left.current || !requested.current || !assetsReady.current) return
    left.current = true
    onBegin()
  }

  useEffect(() => {
    preload(P1, setProgress)
      // The stage gate reports failures; the page still lets the learner in.
      .catch(() => {})
      .finally(() => { assetsReady.current = true; maybeLeave.current() })
  }, [])

  const begin = () => {
    if (requested.current) return
    requested.current = true
    if (!assetsReady.current) setWaiting(true)
    maybeLeave.current()
  }

  return (
    <section className={`fm-page p01${reducedMotion ? ' is-reduced' : ''}`}>
      {/* Context, not subject: the city is defocused and washed out under the
          title so the hardware on the right stays the sharpest thing here. */}
      <img className="fm-media fm-media--soft" src={urlFor('iso-background')} alt="" />
      <div className="p01-wash" aria-hidden="true" />

      <img
        className="p01-hero"
        src={urlFor('welcome-hero')}
        alt="An LP12 small-cell antenna mounted on a roadside pole above Awolowo Way"
      />

      <div className="p01-brand">
        <span className="p01-brandmark" aria-hidden="true" />
        MIVA OPEN UNIVERSITY
      </div>

      <div className="p01-stack">
        {/* Two block spans rather than a <br>: the break has to be visual only,
            and a <br> here makes the accessible name read "FIELDMASTER". */}
        <h1 className="p01-title"><span>FIELD</span> <span>MASTER</span></h1>
        <p className="p01-sub">LP12 Small-Cell Installation</p>
        <p className="p01-where">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0
                     9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
          </svg>
          Awolowo Way · Ikeja, Lagos
        </p>

      </div>

      {/* Pinned to the page rather than trailing the copy: the specification
          puts the CTA at 5.5vw / bottom 12vh, and letting it follow the text
          would move it every time a line wraps. */}
      <div className="p01-action">
        <button className="fm-btn p01-cta" type="button" onClick={begin} disabled={waiting}>
          <span className="fm-btn-glyph" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M8 5.5v13l11-6.5z" />
            </svg>
          </span>
          {waiting ? `Preparing simulation — ${Math.round(progress * 100)}%` : 'Begin Simulation'}
        </button>

        {/* Only once the learner is waiting on us. Real progress or nothing. */}
        {waiting && (
          <span className="p01-progress" role="status" aria-live="polite">
            <i style={{ transform: `scaleX(${progress})` }} />
          </span>
        )}
      </div>
    </section>
  )
}
