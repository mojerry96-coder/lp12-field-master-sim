import { urlFor } from '../lib/assetManifest'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSim } from '../store'
import LP12LiveViewport from './LP12LiveViewport'
import GuidedHandOverlay from './GuidedHandOverlay'
import {
  MeasurementIntervalPage, HysteresisPage, TimeToTriggerPage, OptimisationCompletePage,
} from './TuningPages'
import {
  INITIAL_TUNING, TABLET_ARTBOARD, LOGICAL_SCREEN, deriveDomeState, isOnTarget,
} from './tuning-config'
import './lp12-tuning.css'

/**
 * LP12 tablet network-tuning scene.
 *
 * The whole composition is one fixed 1672×941 artboard scaled uniformly to the
 * browser — background plate, tablet screen and hand overlays together. Scaling
 * them independently is what would let the coded UI drift out of the physical
 * tablet's screen, so there is exactly one scale factor for the scene and one
 * more for the logical 4:3 screen inside it.
 */

const ARTBOARD = TABLET_ARTBOARD
const SCREEN = TABLET_ARTBOARD.screen

/**
 * Cursor parallax for the whole scene.
 *
 * The tablet is treated as one physical object that turns slightly toward the
 * pointer, rather than as separate layers sliding over each other. That matters
 * here: the coded UI is clipped inside a photographed aperture, so any layer
 * that moved independently of the plate would slide out from behind the bezel
 * and break the illusion it exists to create. One transform on the artboard
 * moves the plate, the screen and the hand together, and the depth comes from
 * perspective instead.
 *
 * The tilt is deliberately small. GuidedHandOverlay converts a target's browser
 * rectangle back into artboard coordinates, and a rotated element reports the
 * bounding box of its rotated quad; a few degrees keeps that error well under a
 * pixel, where a showy tilt would walk the fingertip off its button.
 *
 * Motion is eased toward the pointer each frame rather than applied directly,
 * so a fast flick across the screen glides instead of snapping.
 */
const PARALLAX = { rotate: 3.2, shift: 16, glide: 0.085 }

/**
 * The street behind the tablet is a SEPARATE plane, and it has to be.
 *
 * Everything above is why the tablet, its screen and the hand share one
 * transform — the coded UI is clipped inside a photographed aperture. The
 * backdrop has no such registration: nothing is clipped against it, so it is
 * free to move at its own rate, and moving two planes at different rates is
 * the only thing that actually reads as depth. One plane tilting is a tilt.
 *
 * It travels the OPPOSITE way and further, the way a distant background slides
 * against a near subject, and it carries no rotation — a rotating backdrop
 * behind a rotating tablet just looks like the whole photograph is loose.
 */
const BACKDROP = { shift: -34, scale: 1.14 }

function useCursorParallax(hostRef, enabled) {
  const [transform, setTransform] = useState('')
  const [backdrop, setBackdrop] = useState('')

  useEffect(() => {
    if (!enabled) { setTransform(''); return undefined }
    const host = hostRef.current
    if (!host) return undefined

    const target = { x: 0, y: 0 }
    const eased = { x: 0, y: 0 }
    let frame = 0
    let settled = false

    const onPointerMove = (e) => {
      const r = host.getBoundingClientRect()
      if (!r.width || !r.height) return
      // -1..1 from the centre of the scene.
      target.x = ((e.clientX - r.left) / r.width) * 2 - 1
      target.y = ((e.clientY - r.top) / r.height) * 2 - 1
      settled = false
    }
    // Leaving the scene returns it to rest rather than freezing mid-tilt.
    const onPointerLeave = () => { target.x = 0; target.y = 0; settled = false }

    const tick = () => {
      eased.x += (target.x - eased.x) * PARALLAX.glide
      eased.y += (target.y - eased.y) * PARALLAX.glide
      const done = Math.abs(target.x - eased.x) < 0.0005 && Math.abs(target.y - eased.y) < 0.0005
      if (!done || !settled) {
        setTransform(
          `rotateY(${(eased.x * PARALLAX.rotate).toFixed(3)}deg) `
          + `rotateX(${(-eased.y * PARALLAX.rotate).toFixed(3)}deg) `
          + `translate3d(${(eased.x * PARALLAX.shift).toFixed(2)}px, `
          + `${(eased.y * PARALLAX.shift * 0.6).toFixed(2)}px, 0)`,
        )
        setBackdrop(
          `scale(${BACKDROP.scale}) `
          + `translate3d(${(eased.x * BACKDROP.shift).toFixed(2)}px, `
          + `${(eased.y * BACKDROP.shift * 0.6).toFixed(2)}px, 0)`,
        )
        settled = done
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('pointerleave', onPointerLeave)
    return () => {
      cancelAnimationFrame(frame)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [hostRef, enabled])

  return { transform, backdrop }
}

function useContainedScale(width, height) {
  const hostRef = useRef(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const update = () => {
      const rect = host.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      setScale(Math.min(rect.width / width, rect.height / height))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [width, height])

  return { hostRef, scale }
}

function LogicalScreenScaler({ hostWidth, hostHeight, children }) {
  const scale = Math.min(hostWidth / LOGICAL_SCREEN.width, hostHeight / LOGICAL_SCREEN.height)
  const x = (hostWidth - LOGICAL_SCREEN.width * scale) / 2
  const y = (hostHeight - LOGICAL_SCREEN.height * scale) / 2
  return (
    <div
      className="lp12-logical-screen"
      style={{
        width: LOGICAL_SCREEN.width,
        height: LOGICAL_SCREEN.height,
        transform: `translate(${x}px, ${y}px) scale(${scale})`,
      }}
    >
      {children}
    </div>
  )
}

function TopNavigation() {
  return (
    <header className="lp12-topbar">
      <div className="lp12-brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <path d="M5 9a9 9 0 0 1 14 0M8 12.5a5 5 0 0 1 8 0" />
          <circle cx="12" cy="16.5" r="1.6" fill="currentColor" stroke="none" />
        </svg>
        <span>FIELD MASTER</span>
      </div>

      <nav className="lp12-top-actions" aria-label="Tuning navigation">
        <button type="button" aria-label="Search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="11" cy="11" r="6" /><path d="m20 20-4-4" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" aria-label="Menu">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <span className="lp12-current-module">LP12 Network Tuning</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="3" y="14" width="3" height="6" rx="1" opacity=".55" />
          <rect x="8" y="11" width="3" height="9" rx="1" opacity=".7" />
          <rect x="13" y="7" width="3" height="13" rx="1" opacity=".85" />
          <rect x="18" y="4" width="3" height="16" rx="1" />
        </svg>
      </nav>

      <div className="lp12-operator">
        <span className="lp12-avatar" aria-hidden="true" />
        <span>Operator<small><i />Connected</small></span>
      </div>
    </header>
  )
}

export default function LP12TabletTuningScene({ onExit }) {
  const reducedMotion = useSim((s) => s.reducedMotion)
  const performanceTier = useSim((s) => s.performanceTier)
  const { hostRef, scale } = useContainedScale(ARTBOARD.width, ARTBOARD.height)
  // A pointer-driven tilt is exactly the sustained motion prefers-reduced-motion
  // asks us to drop, so it is gated rather than merely slowed.
  const { transform: parallax, backdrop } = useCursorParallax(hostRef, !reducedMotion)

  const [step, setStep] = useState('interval')
  const [values, setValues] = useState(INITIAL_TUNING)
  const [handCue, setHandCue] = useState(null)
  const [hint, setHint] = useState('')
  const [nudge, setNudge] = useState(false)
  const [announce, setAnnounce] = useState('')
  const nudgeTimer = useRef(null)

  const domeState = useMemo(() => deriveDomeState(step, values), [step, values])

  // A learner touching a control dismisses the demonstration immediately.
  const dismissCue = useCallback(() => setHandCue(null), [])

  const reject = useCallback((message) => {
    setHint(message)
    setNudge(true)
    clearTimeout(nudgeTimer.current)
    nudgeTimer.current = window.setTimeout(() => setNudge(false), 340)
  }, [])

  const advance = useCallback((targetId, next, label) => {
    setHandCue({ targetId, sequence: 'tap' })
    setHint('')
    setAnnounce(`${label} confirmed.`)
    window.setTimeout(() => {
      setStep(next)
      setHandCue(null)
    }, 440)
  }, [])

  const apply = useCallback(() => {
    if (step === 'interval') {
      if (!isOnTarget('interval', values)) return reject('Match the target sampling interval.')
      return advance('apply-interval', 'hysteresis', 'Measurement interval 128 ms')
    }
    if (step === 'hysteresis') {
      if (!isOnTarget('hysteresis', values)) return reject('Stabilise the handover boundary.')
      return advance('apply-hysteresis', 'timeToTrigger', 'Hysteresis 2.5 dB')
    }
    if (step === 'timeToTrigger') {
      if (!isOnTarget('timeToTrigger', values)) return reject('Set the required trigger timing.')
      return advance('confirm-ttt', 'complete', 'Time-to-trigger 480 ms')
    }
    return undefined
  }, [step, values, advance, reject])

  const setValue = useCallback((key) => (v) => {
    dismissCue()
    setHint('')
    setValues((prev) => ({ ...prev, [key]: v }))
  }, [dismissCue])

  return (
    <main ref={hostRef} className="lp12-scene" aria-label="LP12 network tuning">
      {/* Blurred street, its own plane. Oversized and clipped by .lp12-scene so
          the counter-shift never exposes an edge. */}
      <div
        className="lp12-backdrop"
        style={{ transform: `translate(-50%, -50%) ${backdrop}` }}
        aria-hidden="true"
      >
        <img src={urlFor('street-background')} alt="" draggable={false} />
      </div>

      <div
        className="lp12-artboard"
        style={{
          width: ARTBOARD.width,
          height: ARTBOARD.height,
          transform: `translate(-50%, -50%) scale(${scale}) ${parallax}`,
        }}
      >
        {/* Hand and tablet only — the street is the plane behind. */}
        <img
          className="lp12-tablet-plate"
          src={urlFor('tablet-foreground')}
          alt="A field engineer holding a landscape tablet on Awolowo Way"
          draggable={false}
        />

        <div
          className="lp12-screen-aperture"
          style={{
            left: SCREEN.left,
            top: SCREEN.top,
            width: SCREEN.width,
            height: SCREEN.height,
            borderRadius: SCREEN.radius,
          }}
        >
          <LogicalScreenScaler hostWidth={SCREEN.width} hostHeight={SCREEN.height}>
            <div className="lp12-app">
              <TopNavigation />

              <LP12LiveViewport
                step={step}
                domeState={domeState}
                performanceTier={performanceTier}
              />

              <section className="lp12-bento-panel">
                {step === 'interval' && (
                  <MeasurementIntervalPage
                    value={values.intervalMs}
                    onChange={setValue('intervalMs')}
                    onApply={apply}
                    hint={hint}
                    nudge={nudge}
                  />
                )}
                {step === 'hysteresis' && (
                  <HysteresisPage
                    value={values.hysteresisDb}
                    onChange={setValue('hysteresisDb')}
                    onApply={apply}
                    hint={hint}
                    nudge={nudge}
                  />
                )}
                {step === 'timeToTrigger' && (
                  <TimeToTriggerPage
                    value={values.timeToTriggerMs}
                    onChange={setValue('timeToTriggerMs')}
                    onApply={apply}
                    hint={hint}
                    nudge={nudge}
                  />
                )}
                {step === 'complete' && (
                  <OptimisationCompletePage
                    onContinue={() => {
                      setHandCue({ targetId: 'continue-corridor', sequence: 'tap' })
                      window.setTimeout(() => { setHandCue(null); onExit?.() }, 440)
                    }}
                  />
                )}
              </section>
            </div>
          </LogicalScreenScaler>
        </div>

        <GuidedHandOverlay cue={handCue} reducedMotion={reducedMotion} />
      </div>

      <p className="lp12-sr-only" role="status" aria-live="polite">{announce}</p>

      <div className="lp12-rotate-prompt">
        <p>Rotate your device to landscape to continue the LP12 tuning sequence.</p>
      </div>
    </main>
  )
}
