import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { urlFor } from '../lib/assetManifest'
import { useSim } from '../store'
import LP12LiveViewport from './LP12LiveViewport'
import TuningStepPage from './TuningStepPage'
import { TUNING_STEPS } from './tuning-steps'
import Page18ReporterOptimised from './Page18ReporterOptimised'
import NetworkTestPage from './NetworkTestPage'
import GuidedHandOverlay from './GuidedHandOverlay'
import BackButton from '../components/BackButton'
import {
  TABLET_ARTBOARD, LOGICAL_SCREEN, PARALLAX_LIMITS,
  deriveDomeState,
} from './tuning-config'
import './lp12-tuning.css'

/**
 * LP12 tablet network-tuning scene.
 *
 * The tablet, its screen and the hand overlay are one 1672×941 artboard scaled
 * uniformly to the browser: the coded UI is clipped inside a photographed
 * aperture, so anything that moved independently of the plate would slide out
 * from behind the bezel. The street is the one thing that is free to move at
 * its own rate, and that difference is what actually reads as depth.
 */

const ARTBOARD = TABLET_ARTBOARD
const SCREEN = TABLET_ARTBOARD.screen
const P = PARALLAX_LIMITS

/**
 * Pointer parallax for the two planes.
 *
 * Transforms are written straight to the element refs inside the rAF loop
 * rather than through React state, so a pointer sweep never re-renders the
 * tuning UI underneath it. Motion is eased toward the pointer each frame, so a
 * fast flick glides instead of snapping.
 */
function useLayeredParallax({ hostRef, deviceRef, streetRef, enabled, baseTransform }) {
  const strengthRef = useRef(1)
  const baseRef = useRef(baseTransform)
  baseRef.current = baseTransform

  useEffect(() => {
    const device = deviceRef.current
    const street = streetRef.current
    if (device) device.style.transform = baseRef.current
    if (street) street.style.transform = `translate(-50%, -50%) scale(${P.street.scale})`
    if (!enabled) return undefined

    const host = hostRef.current
    if (!host) return undefined

    const target = { x: 0, y: 0 }
    const eased = { x: 0, y: 0 }
    let frame = 0

    const onPointerMove = (e) => {
      const r = host.getBoundingClientRect()
      if (!r.width || !r.height) return
      target.x = ((e.clientX - r.left) / r.width) * 2 - 1
      target.y = ((e.clientY - r.top) / r.height) * 2 - 1
    }
    // Leaving the scene eases it back to rest rather than freezing mid-tilt.
    const onPointerLeave = () => { target.x = 0; target.y = 0 }

    const tick = () => {
      eased.x += (target.x - eased.x) * P.glide
      eased.y += (target.y - eased.y) * P.glide
      const s = strengthRef.current
      const dx = eased.x * s
      const dy = eased.y * s

      const d = deviceRef.current
      if (d) {
        d.style.transform = `${baseRef.current} `
          + `rotateY(${(dx * P.device.rotateY).toFixed(3)}deg) `
          + `rotateX(${(-dy * P.device.rotateX).toFixed(3)}deg) `
          + `translate3d(${(dx * P.device.x).toFixed(2)}px, ${(dy * P.device.y).toFixed(2)}px, 0)`
      }
      const st = streetRef.current
      if (st) {
        st.style.transform = `translate(-50%, -50%) scale(${P.street.scale}) `
          + `translate3d(${(-dx * P.street.x).toFixed(2)}px, ${(-dy * P.street.y).toFixed(2)}px, 0)`
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
  }, [hostRef, deviceRef, streetRef, enabled])

  // Dragging a slider inside the screen damps the scene: a control that slides
  // away under the finger is unusable, so the parallax steps aside rather than
  // fighting the input.
  const setDragging = useCallback((dragging) => {
    strengthRef.current = dragging ? P.dragStrength : 1
  }, [])

  return setDragging
}

function useContainedScale(width, height) {
  const hostRef = useRef(null)
  const [fit, setFit] = useState({ scale: 1, drop: 0 })

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const update = () => {
      const rect = host.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const scale = Math.min(rect.width / width, rect.height / height)
      // Contain-fitting a 16:9-ish artboard into a taller viewport leaves a
      // band above and below. Centred, the lower band shows as a gap under the
      // hand — the plate is cropped at the wrist, so the hand needs to run off
      // the bottom edge rather than stop short of it. Dropping the whole
      // artboard by half the letterbox puts its bottom on the viewport bottom
      // and moves all the spare room above, where the sky already is.
      const drop = Math.max(0, (rect.height - height * scale) / 2)
      setFit((prev) => (prev.scale === scale && prev.drop === drop
        ? prev : { scale, drop }))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [width, height])

  return { hostRef, scale: fit.scale, drop: fit.drop }
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

/* The bar keeps its glyphs and drops its wording: three lines of near-white
   chrome text — the wordmark, the module label and the operator's name and
   connection state — that named things the learner can already see and that
   competed with the setting the page is actually asking about. */
function TopNavigation() {
  return (
    <header className="lp12-topbar">
      <div className="lp12-brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <path d="M5 9a9 9 0 0 1 14 0M8 12.5a5 5 0 0 1 8 0" />
          <circle cx="12" cy="16.5" r="1.6" fill="currentColor" stroke="none" />
        </svg>
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="3" y="14" width="3" height="6" rx="1" opacity=".55" />
          <rect x="8" y="11" width="3" height="9" rx="1" opacity=".7" />
          <rect x="13" y="7" width="3" height="13" rx="1" opacity=".85" />
          <rect x="18" y="4" width="3" height="16" rx="1" />
        </svg>
      </nav>

      <div className="lp12-operator">
        <span className="lp12-avatar" aria-hidden="true" />
      </div>
    </header>
  )
}

export default function LP12TabletTuningScene({ onExit }) {
  const reducedMotion = useSim((s) => s.reducedMotion)
  const performanceTier = useSim((s) => s.performanceTier)
  // The install's own decisions. The network test scores all five together, so
  // the two the learner made on the pole come along with the three made here.
  const height = useSim((s) => s.height)
  const downtilt = useSim((s) => s.downtilt)
  const { hostRef, scale, drop } = useContainedScale(ARTBOARD.width, ARTBOARD.height)
  const deviceRef = useRef(null)
  const streetRef = useRef(null)
  // The drop is prepended, so it lands in the parent's pixels rather than
  // being multiplied by the artboard's own scale.
  const baseTransform = `translate(-50%, calc(-50% + ${drop.toFixed(1)}px)) scale(${scale})`
  // A pointer-driven tilt is exactly the sustained motion prefers-reduced-motion
  // asks us to drop, so it is gated rather than merely slowed.
  const setDragging = useLayeredParallax({
    hostRef, deviceRef, streetRef, enabled: !reducedMotion, baseTransform,
  })


  /* Step and values are the store's, not this component's. The corridor test
     can send the learner back to the pole to change mount height or downtilt,
     which switches mode and unmounts this scene — local state would not
     survive the trip and they would return to find their reporter settings
     back at the entry values. */
  const step = useSim((s) => s.tuningStep)
  const values = useSim((s) => s.tuning)
  const revisit = useSim((s) => s.revisit)
  const setStep = useSim((s) => s.setTuningStep)
  const [handCue, setHandCue] = useState(null)
  const [announce, setAnnounce] = useState('')

  const domeState = useMemo(() => deriveDomeState(step, values), [step, values])

  // A learner touching a control dismisses the demonstration immediately.
  const dismissCue = useCallback(() => setHandCue(null), [])

  const advance = useCallback((targetId, next, label) => {
    setHandCue({ targetId, sequence: 'tap' })
    setAnnounce(`${label} confirmed.`)
    window.setTimeout(() => {
      setStep(next)
      setHandCue(null)
    }, 440)
  }, [setStep])

  /**
   * Apply accepts whatever the learner chose.
   *
   * These three steps used to refuse anything but the target value, which made
   * the corridor test unable to fail and turned the sliders into a lock with
   * the combination written on them. The judgement now happens once, on the
   * road, where a wrong value has a visible consequence — so here the only
   * question is where to go next.
   *
   * A learner who arrived from the test's debrief goes straight back to it
   * rather than walking the remaining steps again; `revisit` is what says so.
   */
  const apply = useCallback(() => {
    const label = {
      interval: `Measurement interval ${values.intervalMs} ms`,
      hysteresis: `Hysteresis ${values.hysteresisDb.toFixed(1)} dB`,
      timeToTrigger: `Time-to-trigger ${values.timeToTriggerMs} ms`,
    }[step]
    const targetId = {
      interval: 'apply-interval',
      hysteresis: 'apply-hysteresis',
      timeToTrigger: 'confirm-ttt',
    }[step]
    if (!label) return undefined

    if (revisit === step) {
      setHandCue({ targetId, sequence: 'tap' })
      setAnnounce(`${label} confirmed. Re-running the corridor test.`)
      window.setTimeout(() => {
        setHandCue(null)
        useSim.getState().resumeFromRevision()
      }, 440)
      return undefined
    }

    const next = { interval: 'hysteresis', hysteresis: 'timeToTrigger',
                   timeToTrigger: 'networkTest' }[step]
    return advance(targetId, next, label)
  }, [step, values, revisit, advance])

  const setValue = useCallback((key) => (v) => {
    dismissCue()
    useSim.getState().setTuning({ [key]: v })
  }, [dismissCue])

  /**
   * The network test takes the whole screen, not the tablet's.
   *
   * Every other step of this sequence happens on the device in the engineer's
   * hands. This one is the corridor itself being driven, so the tablet — the
   * frame that has carried the whole tuning phase — steps out of the way and
   * the site becomes the interface. Section 1.1: the road, the hardware and
   * the network field are the primary interface, and the UI supports them.
   */
  /* Memoised on the five primitives, not rebuilt inline in the JSX.
     NetworkTestPage memoises its whole quality model on this object and
     reports the verdict from an effect keyed to it — handing it a fresh
     literal every render made that effect re-fire, write to the store, and
     re-render the scene, which is an update loop the error boundary catches
     as "Maximum update depth exceeded". */
  const testSettings = useMemo(() => ({
    mountHeight: height,
    downtilt,
    measurementInterval: values.intervalMs,
    hysteresis: values.hysteresisDb,
    timeToTrigger: values.timeToTriggerMs,
  }), [height, downtilt, values.intervalMs, values.hysteresisDb, values.timeToTriggerMs])

  const noteResult = useCallback((outcome) => {
    useSim.getState().noteNetworkTest(outcome)
  }, [])

  /**
   * One step back through the tuning sequence.
   *
   * The steps are a chain, so back is the chain read the other way. From the
   * first one there is nowhere left inside tuning to go, so it leaves the
   * sequence and returns to the installation's completion page — the store's
   * installStage still says 'complete', and the install route resumes there.
   *
   * Nothing is unwound on the way: the learner's five values live in the store
   * and are deliberately left alone, so stepping back and forward again shows
   * them exactly what they chose.
   */
  const BACK_STEP = {
    hysteresis: 'interval',
    timeToTrigger: 'hysteresis',
    networkTest: 'timeToTrigger',
    complete: 'networkTest',
  }

  const goBack = () => {
    const previous = BACK_STEP[step]
    if (previous) return setStep(previous)
    // Out of tuning altogether, back to Page 14.
    return useSim.setState({ mode: 'build', installStage: 'complete' })
  }

  /* The debrief's way back. Two of the five decisions were made on the pole
     rather than on the tablet, so they route through the install stages; the
     other three are steps of this scene. Either way the learner lands on the
     one control that owns the decision, holding the value they chose. */
  const adjust = (which) => {
    const st = useSim.getState()
    if (which === 'height' || which === 'downtilt') st.reviseRig(which)
    else st.reviseTuning(which)
  }

  if (step === 'networkTest') {
    return (
      <>
        <NetworkTestPage
          settings={testSettings}
          onContinue={() => setStep('complete')}
          onAdjust={adjust}
          onResult={noteResult}
        />
        {/* No orientation guard here, unlike the tablet steps. It carried one
            for consistency with them, but the corridor test is not a tablet —
            it is a full-screen 3D scene with glass panels over it, and those
            panels lay out in portrait now. The three tuning steps keep their
            guard because they are literally a landscape device held in shot;
            this screen has no such excuse for refusing to draw. */}
        {/* The corridor test is the one page over a dark sky, so the control
            takes the inverted glass or it vanishes into it. */}
        <BackButton onBack={goBack} onDark />
      </>
    )
  }

  return (
    <main
      ref={hostRef}
      className="lp12-scene"
      aria-label="LP12 network tuning"
      onPointerUp={() => setDragging(false)}
      onPointerLeave={() => setDragging(false)}
    >
      {/* Blurred street, its own plane. Oversized and clipped by .lp12-scene so
          the counter-shift never exposes an edge. */}
      <div ref={streetRef} className="lp12-backdrop" aria-hidden="true">
        <img src={urlFor('street-background')} alt="" draggable={false} />
      </div>

      <div
        ref={deviceRef}
        className="lp12-artboard"
        style={{
          width: ARTBOARD.width,
          height: ARTBOARD.height,
          transform: baseTransform,
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
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
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

              {/* The live viewport is off on the redesigned tuning steps.
                  Every reference render for pages 15-18 shows a tablet whose
                  screen is entirely UI — on those pages the tablet is the
                  media, and a 3D panel inside it would be a second subject
                  competing with the decision the page is asking for. It stays
                  for the steps the redesign has not reached. */}
              {!TUNING_STEPS[step] && step !== 'complete' && (
                <LP12LiveViewport
                  step={step}
                  domeState={domeState}
                  performanceTier={performanceTier}
                />
              )}

              <section className={`lp12-bento-panel${TUNING_STEPS[step] || step === 'complete' ? ' is-full' : ''}`}>
                {TUNING_STEPS[step] && (
                  <TuningStepPage
                    step={TUNING_STEPS[step]}
                    value={values[TUNING_STEPS[step].field]}
                    onChange={setValue(TUNING_STEPS[step].field)}
                    onApply={apply}
                  />
                )}
                {step === 'complete' && (
                  <Page18ReporterOptimised
                    values={values}
                    onComplete={() => {
                      setHandCue({ targetId: 'complete-commissioning', sequence: 'tap' })
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

      <BackButton onBack={goBack} />

      <div className="lp12-rotate-prompt">
        <p>Rotate your device to landscape to continue the LP12 tuning sequence.</p>
      </div>
    </main>
  )
}
