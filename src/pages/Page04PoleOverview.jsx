import { useEffect, useRef } from 'react'

/**
 * PAGE 04 — Pole Overview / Manual Orbit.
 *
 * The first page where the subject is the live model rather than a plate. The
 * pole holds the right of the frame, the street stays behind it — this is the
 * last page before isolation, and the point of inspecting the column here is
 * that it is still standing in the street it serves.
 *
 * Orbit is the learner's. The simulation used to turn the hardware on a 22
 * second clock whether anyone was looking or not; now nothing moves unless the
 * wheel moves, and it stops the moment the wheel does. The camera work belongs
 * to CameraDirector — this page only routes wheel events into the shared orbit
 * input and says whether orbit is on.
 */

function OrbitGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <ellipse cx="12" cy="12" rx="9.2" ry="4.4" fill="none"
               stroke="currentColor" strokeWidth="1.6"
               transform="rotate(-28 12 12)" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <path d="M18.4 7.6l1.5.9-.9 1.5M5.6 16.4l-1.5-.9.9-1.5"
            fill="none" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Page04PoleOverview({
  orbitInput, orbitEnabled, onOrbit, onBeginInstallation, busy, children,
}) {
  const hostRef = useRef(null)

  // Non-passive, because the handler calls preventDefault when orbit is on —
  // a passive listener cannot, and the page would scroll under the model.
  // Attached for the life of the page rather than only while orbit is enabled:
  // the input itself ignores wheel events when disabled, so there is one place
  // that decides, not two.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !orbitInput) return undefined
    const onWheel = (e) => orbitInput.onWheel(e)
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [orbitInput])

  return (
    <section ref={hostRef} className="fm-page p04" aria-label="Pole overview">
      {/* The live model. Held to the right 62% so the pole composes against
          the title rather than sitting under it. */}
      <div className="p04-viewport">{children}</div>

      <div className="p04-brand">
        <span className="p04-brandmark" aria-hidden="true" />
        MIVA OPEN UNIVERSITY
      </div>

      <div className="p04-stack">
        <h1 className="p04-title"><span>POLE</span> <span>OVERVIEW</span></h1>
        <p className="p04-sub">LP12 Small-Cell Installation</p>
        <p className="p04-where">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0
                     9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
          </svg>
          Awolowo Way · Ikeja, Lagos
        </p>
      </div>

      {/* Temporary, and only while orbit is on — it is a hint, not a status
          bar, so it has nothing to say the rest of the time. */}
      {orbitEnabled && (
        <div className="fm-glass p04-hint" role="status">
          <OrbitGlyph />
          Orbit enabled · Scroll to inspect
        </div>
      )}

      <div className="fm-glass p04-actions">
        <button
          type="button"
          className={`fm-btn p04-orbit${orbitEnabled ? ' is-on' : ''}`}
          aria-pressed={orbitEnabled}
          onClick={onOrbit}
        >
          <span className="fm-btn-glyph" aria-hidden="true"><OrbitGlyph /></span>
          Orbit
        </button>

        <button type="button" className="fm-btn p04-begin"
                onClick={onBeginInstallation} disabled={busy}>
          <span className="fm-btn-glyph" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M8 5.5v13l11-6.5z" />
            </svg>
          </span>
          Begin Installation
        </button>
      </div>
    </section>
  )
}
