import { useEffect, useRef } from 'react'
import { useSim } from '../store'
import { effectiveCoverageRadiusM } from '../lib/coverage'

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
 * The chip REPORTS, it does not judge. It used to read a hardcoded "Optimal",
 * on the reasoning that both rig gates had to pass before this page could be
 * reached, so the footprint on screen could only be the correct one. That
 * stopped being true when the assessment model changed: height and downtilt are
 * now accepted whatever the learner sets them to, and the corridor test is the
 * thing that judges them. So the page could be standing in front of a 215 m
 * footprint thrown by a 2 degree tilt while telling the learner it was optimal.
 *
 * Printing the reach the learner's own settings produce is true at every
 * setting, and it is the number the dome in front of them is drawn from. It
 * also leaves the verdict where the user asked for it — the corridor test names
 * what went wrong and refers them back — rather than pre-empting it here.
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

  // The same function the 3D dome is sized from, so the number in the chip and
  // the shape on the screen can never disagree.
  const height = useSim((s) => s.height)
  const downtilt = useSim((s) => s.downtilt)
  const reachM = effectiveCoverageRadiusM(height, downtilt)

  // Non-passive, because the handler calls preventDefault when orbit is on —
  // a passive listener cannot, and the page would scroll under the model.
  // Attached for the life of the page rather than only while orbit is enabled:
  // the input itself ignores wheel events when disabled, so there is one place
  // that decides, not two.
  //
  // The pointer gestures are attached the same way and for the same reason:
  // left drag orbits, right or middle drag pans, wheel dollies, double click
  // returns to the authored framing — the gesture set of any 3D application.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !orbitInput) return undefined
    const onWheel = (e) => orbitInput.onWheel(e)
    const onDown = (e) => {
      // Never steal the buttons and chips layered over the scene.
      if (e.target.closest('button, a, input')) return
      if (orbitInput.onPointerDown(e)) {
        e.preventDefault()
        host.setPointerCapture?.(e.pointerId)
      }
    }
    const onMove = (e) => { if (orbitInput.onPointerMove(e)) e.preventDefault() }
    const onUp = (e) => {
      if (orbitInput.onPointerUp(e)) host.releasePointerCapture?.(e.pointerId)
    }
    const onMenu = (e) => { if (orbitInput.enabled) e.preventDefault() }
    const onDouble = () => orbitInput.requestReset()

    host.addEventListener('wheel', onWheel, { passive: false })
    host.addEventListener('pointerdown', onDown)
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerup', onUp)
    host.addEventListener('pointercancel', onUp)
    host.addEventListener('contextmenu', onMenu)
    host.addEventListener('dblclick', onDouble)
    return () => {
      host.removeEventListener('wheel', onWheel)
      host.removeEventListener('pointerdown', onDown)
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerup', onUp)
      host.removeEventListener('pointercancel', onUp)
      host.removeEventListener('contextmenu', onMenu)
      host.removeEventListener('dblclick', onDouble)
    }
  }, [orbitInput])

  return (
    <section ref={hostRef}
             className={`fm-page p13${orbitEnabled ? ' is-navigating' : ''}`}
             aria-label="Network coverage">
      <div className="p13-viewport">{children}</div>


      <div className="fm-glass p13-chip">
        <span className="p13-bars" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
        <span className="p13-chip-text">
          <b>Network coverage</b>
          <span className="p13-state">
            <i aria-hidden="true" /> Reaches {Math.round(reachM)} m along the road
          </span>
        </span>
      </div>

      {/* Temporary, and only while orbit is on — it is a hint, not a status
          bar, so it has nothing to say the rest of the time. */}
      {orbitEnabled && (
        <div className="fm-glass p13-hint" role="status">
          <OrbitGlyph />
          Orbit enabled · Drag to turn · Scroll to zoom · Right-drag to pan
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
