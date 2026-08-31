import { useCallback, useEffect, useState } from 'react'
import {
  useSim, selectShowHotspot, selectShowCanvas, selectFocusBackground,
  selectControlsEnabled,
} from './store'
import BackgroundPlate from './components/BackgroundPlate'
import Page03LocateSite from './pages/Page03LocateSite'
import NetworkCoverageDome, { DeadZoneDome } from './components/NetworkCoverageDome'
import LP12BuildCanvas from './components/LP12BuildCanvas'
import InstallationPage from './InstallationPage'
import LP12TabletTuningScene from './tuning/LP12TabletTuningScene'
import CanvasDimLayer from './components/CanvasDimLayer'
import { STAGE_CONFIG, detectPerformanceTier, prefersReducedMotion } from './lib/stageConfig'
import Page01Welcome from './pages/Page01Welcome'
import Page02MissionBriefing from './pages/Page02MissionBriefing'
import StageGate from './components/StageGate'
import BackButton from './components/BackButton'
import { PerformanceReview } from './components/CompletionScreen'
import Page19CommissioningComplete from './pages/Page19CommissioningComplete'
import { P2, P3, warm } from './lib/preloader'
import { urlFor } from './lib/assetManifest'

// The locate page is the isometric city rendered straight out of the Blender
// scene (CAM_ENV_ISOMETRIC), not the aerial photograph. It is the same
// geometry the build canvas loads, so the site the learner picks on the map is
// literally the site they then work on.
//
// No video plate here: the render is a still, and a photographic loop under a
// low-poly render read as two different scenes stitched together.
// Through the manifest, so the locate page and the completion screen ask for
// the identical URL and share one decode.
const BACKGROUND_URL = urlFor('iso-background')
const BACKGROUND_VIDEO_URL = null

/* "Return to Course" is gone with the old completion screen. Page 19's copy
 * list is two buttons — Review Performance and Restart — and its layout rule
 * is to remove everything else. The route it used lived in VITE_COURSE_URL and
 * was only ever rendered when that was set; putting it back is one button and
 * one constant, but it is not on the page the specification describes. */

export default function App() {
  const s = useSim()
  const [flow, setFlow] = useState(null)
  const [studio, setStudio] = useState(null)

  const showHotspot = selectShowHotspot(s)
  const showCanvas = selectShowCanvas(s)
  const focusBackground = selectFocusBackground(s)
  const controlsEnabled = selectControlsEnabled(s)

  const [reviewOpen, setReviewOpen] = useState(false)

  /**
   * The city is context on Page 04 and a distraction from Page 05 onward, so
   * the plate is retired by the install stage rather than by the mode — the
   * mode is 'build' for both. Completion keeps its own studio ground.
   */
  const isolated = (s.mode === 'build' && s.installStage !== 'overview')
    || s.mode === 'complete'
  // Page 04: the plate is the street behind the pole, so it is softened rather
  // than pushed back behind a model the way the old workspace treated it.
  const overview = s.mode === 'build' && s.installStage === 'overview'

  /**
   * Staged preloading.
   *
   * P1 is loaded by the opener itself. P2 starts the moment the first scene is
   * interactive, so the studio is already built by the time the hotspot is
   * clicked; P3 starts once the learner is in the build, so the tablet opens
   * as a finished composition rather than assembling itself.
   */
  useEffect(() => {
    if (!s.openerDone) return undefined
    const id = setTimeout(() => warm(P2), 0)
    return () => clearTimeout(id)
  }, [s.openerDone])

  useEffect(() => {
    if (s.mode !== 'build') return undefined
    const id = setTimeout(() => warm(P3), 0)
    return () => clearTimeout(id)
  }, [s.mode])

  useEffect(() => {
    fetch('/models/camera_studio.json').then((r) => r.json()).then(setStudio).catch(() => {})
    fetch('/models/camera_flow.json').then((r) => r.json()).then(setFlow)
      .catch((e) => useSim.getState().setLoadError('camera_flow.json failed: ' + e))
    useSim.getState().setEnvironment(detectPerformanceTier(), prefersReducedMotion())
  }, [])

  const onModelReady = useCallback((extras, root, controller) => {
    if (extras) {
      const keys = ['mount_height_min','mount_height_max','mount_height_step',
        'mount_height_correct_min','mount_height_correct_max',
        'mount_height_ideal','downtilt_correct']
      const l = {}
      keys.forEach((k) => { if (typeof extras[k] === 'number') l[k] = extras[k] })
      if (Object.keys(l).length) useSim.getState().setLimits(l)
    }
    const st = useSim.getState()
    st.setController(controller)
    st.setModelReady(true, root)
    st.restoreCompletedPoses()      // s34: resume without replaying
  }, [])

  // Stable identities: these feed CameraDirector's effect deps. Inline arrows
  // made the effect re-fire every render, which set state and re-rendered —
  // an infinite loop that starved the render loop and blanked the canvas.
  const onRigMoved = useCallback(() => useSim.getState().bumpRig(), [])
  const onCameraDepart = useCallback(() => useSim.getState().setCameraStatus('moving'), [])
  const onCameraArrive = useCallback(() => useSim.getState().setCameraStatus('idle'), [])

  const onModelError = useCallback((msg) => {
    useSim.getState().setLoadError(msg)
    useSim.getState().setModelReady(false)
  }, [])

  const cfg = STAGE_CONFIG[s.buildStage] ?? STAGE_CONFIG.inspect
  const dimOpacity = s.mode === 'locate' ? 0 : cfg.dimOpacity

  // Page 01 owns the screen until the learner presses Begin Simulation. It
  // preloads P1 while they read, so the wait is spent rather than added.
  // Welcome, then the briefing, then the site. Both sit in front of the
  // simulation while P1 and P2 warm behind them, so the explanation costs the
  // learner nothing — it happens during loading that was going to happen.
  if (!s.openerDone) {
    return (
      <Page01Welcome
        reducedMotion={s.reducedMotion}
        onBegin={useSim.getState().openerFinished}
      />
    )
  }

  if (!s.briefingDone) {
    return (
      <>
        <Page02MissionBriefing
          reducedMotion={s.reducedMotion}
          onBegin={useSim.getState().briefingFinished}
        />
        {/* Back to the welcome. The opener is a flag rather than a route, so
            stepping back is clearing it — and it replays skippably, exactly as
            it does after a restart. */}
        <BackButton onBack={() => useSim.setState({ openerDone: false })} />
      </>
    )
  }

  if (s.mode === 'complete') {
    return (
      <>
        <Page19CommissioningComplete
          onReview={() => setReviewOpen(true)}
          onRestart={useSim.getState().restart}
        />
        {reviewOpen && <PerformanceReview onClose={() => setReviewOpen(false)} />}
      </>
    )
  }

  return (
    <main className={`hybrid-simulation mode-${s.mode}${isolated ? ' is-isolated' : ''}${overview ? ' is-overview' : ''}`}>
      <BackgroundPlate
        imageSrc={BACKGROUND_URL}
        videoSrc={BACKGROUND_VIDEO_URL}
        focused={focusBackground}
        reducedMotion={s.reducedMotion}
        onLoad={useSim.getState().setBgReady}
      />
      <div className="background-focus-overlay" aria-hidden="true" />


      <CanvasDimLayer opacity={dimOpacity} />

      {/* Coverage footprint on the network plate. Rendered under the marker,
          and only in the network view — inside the build view the same dome is
          shown in 3D at the coverage stage instead.

          Gated on the install having happened. Page 03 asks the learner to
          find one column among a dozen, and a coverage dome drawn from default
          height and tilt is a second blue shape on the same plate saying
          nothing — it is a consequence, so it waits until there is one. */}
      {/* One volume over the pole, and which one says whether the street is
          still broken. Red and pulsing while the dead zone is the situation;
          the installed cell's own footprint once there is one to draw. */}
      {showHotspot && s.bgReady && (
        s.installed
          ? <NetworkCoverageDome height={s.height} downtilt={s.downtilt} />
          : <DeadZoneDome reducedMotion={s.reducedMotion} />
      )}

      {showHotspot && s.bgReady && (
        <>
          <Page03LocateSite
            disabled={s.transitionLocked}
            completed={s.installed && s.heightOk() && s.tiltOk()}
            onSelect={s.openBuild}
          />
          <BackButton
            onBack={() => useSim.setState({ briefingDone: false })}
            busy={s.transitionLocked}
          />
        </>
      )}

      {/* The tablet tuning sequence replaces the installation workspace once
          the physical build is signed off. It is a separate mode rather than a
          nested view so the installation route keeps its own state untouched
          and can be returned to unchanged. */}
      {s.mode === 'tuning' ? (
        <StageGate name="Network tuning" priority={P3}
                   onRetreat={() => useSim.getState().returnToSite()}>
        <LP12TabletTuningScene
          onExit={() => {
            // Tuning is the last task, so finishing it ends the simulation.
            // finish() freezes the outcome before anything can reset it — the
            // completion screen and the review both read that snapshot.
            useSim.getState().finish()
          }}
        />
        </StageGate>
      ) : showCanvas && (
        // The installation stage is held until the LP12 GLB is parsed, its
        // materials are built and its shaders are compiled — `modelReady` is
        // set by the canvas, not on mount, so this cannot reveal an empty
        // studio the way clicking the hotspot early used to.
        <StageGate name="Installation workspace" priority={P2}
                   ready={s.modelReady}
                   onRetreat={() => useSim.getState().returnToSite()}>
          <InstallationPage
            studio={studio} flow={flow}
            onExit={() => useSim.getState().returnToSite()}
            onComplete={() => useSim.getState().startTuning()}
          />
        </StageGate>
      )}

      <div className="sr-live" aria-live="polite">
        {s.mode === 'build' ? 'LP12 model opened' : ''}
      </div>

      {s.loadError && (
        <div className="error-panel" role="alert">
          <b>Could not load the LP12 model.</b>
          <p>{s.loadError}</p>
          <button className="ghost" onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}
    </main>
  )
}
