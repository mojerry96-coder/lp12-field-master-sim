import { useEffect, useRef } from 'react'

/**
 * PAGE 13 — Network Coverage.
 *
 * The city comes back (2.8), and the point of the page is what the learner's
 * two rig decisions did to it. So the scene carries the whole message and the
 * chrome is three things: a status chip, orbit, and a way onward. The
 * specification is blunt about the temptation here — "do not build a network
 * dashboard" — and the numbers that would fill one are all derivable from a
 * height and a tilt the learner has already set and confirmed.
 *
 * "Optimal" is not decoration. Both rig gates have to pass before this page can
 * be reached, so by construction the footprint on screen is the correct one;
 * the chip says in words what the dome says in shape, which is also the reason
 * the dome no longer changes hue to signal it.
 *
 * ORBIT lives here rather than on the pole overview. A dome is the one subject
 * in the run whose shape cannot be read from a single angle — how far it
 * reaches down the road, where it stops, how it sits over the buildings — and
 * from head-on it flattens into a circle. The camera behaviour is unchanged
 * from where it was: the axis stays locked, nothing turns on its own, and the
 * wheel is the only thing that moves it.
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

export default function Page13NetworkCoverage({
  orbitInput, orbitEnabled, onOrbit, onContinue, busy, children,
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
    <section ref={hostRef} className="fm-page p13" aria-label="Network coverage">
      <div className="p13-viewport">{children}</div>

      <div className="fm-glass p13-chip">
        <span className="p13-bars" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
        <span className="p13-chip-text">
          <b>Network coverage</b>
          <span className="p13-state">
            <i aria-hidden="true" /> Optimal
          </span>
        </span>
      </div>

      {/* Temporary, and only while orbit is on — it is a hint, not a status
          bar, so it has nothing to say the rest of the time. */}
      {orbitEnabled && (
        <div className="fm-glass p13-hint" role="status">
          <OrbitGlyph />
          Orbit enabled · Scroll to inspect
        </div>
      )}

      <div className="p13-actions">
        <button
          type="button"
          className={`fm-btn p13-orbit${orbitEnabled ? ' is-on' : ''}`}
          aria-pressed={orbitEnabled}
          onClick={onOrbit}
        >
          <span className="fm-btn-glyph" aria-hidden="true"><OrbitGlyph /></span>
          Orbit
        </button>

        <button className="fm-btn p13-continue" type="button"
                onClick={onContinue} disabled={busy}>
          <span className="fm-btn-glyph" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M8 5.5v13l11-6.5z" />
            </svg>
          </span>
          Continue
        </button>
      </div>
    </section>
  )
}
