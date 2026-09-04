import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSim } from './store'
import InstallShell from './components/InstallShell'
import Page04PoleOverview from './pages/Page04PoleOverview'
import AssemblyStagePage from './pages/AssemblyStagePage'
import Page11SetMountHeight from './pages/Page11SetMountHeight'
import Page12SetDowntilt from './pages/Page12SetDowntilt'
import Page13NetworkCoverage from './pages/Page13NetworkCoverage'
import Page14InstallationComplete from './pages/Page14InstallationComplete'
import LP12BuildCanvas from './components/LP12BuildCanvas'
import BackButton from './components/BackButton'
import { createOrbitInput } from './lib/constrainedOrbit'
import {
  STAGES, stageIndex, stageById, COMPLETED_PART_BY_STAGE, STAGE_CAMERA,
  PART_LABELS, PART_ORDER, PART_PREREQ_MESSAGE,
} from './lib/installationStages'

/**
 * The installation workspace: one reusable shell driven by the stage table
 * (spec s12). The 3D viewport sits in the third grid column, so the model is
 * framed inside the viewport rather than centred across the whole window.
 */
/**
 * `onExit` backs out of the installation to the site view; `onComplete` hands
 * over to whatever follows a finished install. They were one callback until the
 * tuning sequence was added, at which point routing both through it meant
 * pressing Back on the very first stage launched the tablet — a learner who had
 * installed nothing being shown the "installation complete" follow-on.
 */
/**
 * Step numbers, derived rather than written down. The install steps are the
 * stages that carry a clip — the overview, the two rig settings and the
 * completion screen are not numbered — so adding or removing an assembly stage
 * renumbers the sequence on its own.
 */
const INSTALL_STEPS = STAGES.filter((s) => s.clip)
const INSTALL_STEP_COUNT = INSTALL_STEPS.length
const INSTALL_STEP_OF = Object.fromEntries(INSTALL_STEPS.map((s, i) => [s.id, i + 1]))

/**
 * Which assembly steps have been through their QA gate.
 *
 * With the last of the six here, the old blue-panel shell no longer appears
 * anywhere in the assembly sequence. It still serves the rig-setting stages
 * and the completion screen until their own pages are built.
 */
const ASSEMBLY_PAGES = ['bands', 'rail', 'pivot', 'antenna', 'fasteners', 'connectors']

/**
 * Every stage the redesign has reached, assembly or not.
 *
 * The leader-line callouts naming the hardware are old-shell furniture: none
 * of the reference renders carry them, and each page's gate forbids adding
 * labels. So they are hidden per redesigned page rather than per assembly
 * page — the assembly list was only ever a proxy for this.
 */
const REDESIGNED_STAGES = [...ASSEMBLY_PAGES, 'height', 'downtilt', 'coverage', 'complete']

export default function InstallationPage({ studio, flow, onExit, onComplete }) {
  const s = useSim()
  /**
   * Which stage is on screen.
   *
   * Normally 'overview' — but the corridor test can ask for a correction to
   * mount height or downtilt, and that request arrives through the store while
   * this route is unmounted (tuning replaces it). So the pending request is
   * read at mount, and watched while mounted in case it never left. Only the
   * two rig stages are honoured; `revisit` also carries tuning step ids, which
   * belong to the other route and are not stages here.
   */
  const [stageId, setStageId] = useState(() => {
    const st = useSim.getState()
    // A correction requested from the corridor test wins; otherwise resume
    // wherever this route was last, so Back out of the tuning sequence lands on
    // the completion page rather than at the top of the install again.
    const pending = st.revisit === 'height' || st.revisit === 'downtilt'
      ? st.revisit
      : st.installStage
    return stageById(pending) ? pending : 'overview'
  })
  // Front by default. Orbit used to be the default because it was automatic,
  // and an automatic turntable at least showed the far side of the pole. Now
  // that orbit is the learner's (specification 2.3), defaulting to it would
  // open every stage on a view that does not move until someone discovers the
  // wheel — so the stage's own authored anchor is the default, and orbit is
  // something the learner turns on.
  const [view, setView] = useState('front')
  const [orbitOn, setOrbitOn] = useState(false)

  // One input for the whole workspace, so a stage change cannot strand a
  // half-turned camera behind a controller that no longer exists.
  const orbitInput = useMemo(() => createOrbitInput(), [])
  const [busy, setBusy] = useState(false)
  /**
   * Which parts are on the pole.
   *
   * Derived from the stage rather than accumulated, because the learner can now
   * step backwards: an array that only ever grew would keep refusing a part as
   * "already installed" after Back had taken it off the pole again, and would
   * come back empty when this route remounts on the way back from tuning. The
   * canvas already derives the assembled pose from the stage the same way.
   */
  const installed = useMemo(() => {
    const here = stageIndex(stageId)
    return STAGES
      .filter((st) => stageIndex(st.id) < here)
      .map((st) => COMPLETED_PART_BY_STAGE[st.id])
      .filter(Boolean)
  }, [stageId])
  const [notice, setNotice] = useState(null)
  // The Blender look, fetched once. SiteLighting rebuilds the rig and the view
  // transform from it, so the two ends cannot drift apart the way a rig
  // restated in JSX does.
  const [look, setLook] = useState(null)

  useEffect(() => {
    fetch('/models/site_look.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then(setLook)
      .catch((e) => console.warn('[LP12] site_look.json unavailable:', e.message))
  }, [])

  const stage = stageById(stageId)

  // Each new part is presented at its authored anchor, and orbit is dropped
  // with the stage that turned it on — carrying it forward would leave the
  // wheel captured on a page whose chrome says nothing about orbit. The
  // coverage stage is the exception: the dome is the whole message there and
  // cannot be read from one angle, so navigation is on from the moment the
  // page opens, with the Orbit button still able to switch it off.
  useEffect(() => {
    const navigate = stageId === 'coverage'
    setView(navigate ? 'orbit' : 'front')
    setOrbitOn(navigate)
    orbitInput.setEnabled(navigate)
  }, [stageId, orbitInput])

  // App retires the city plate off this (specification 2.4): the street stays
  // for the overview and goes the moment the assembly starts.
  useEffect(() => { useSim.getState().setInstallStage(stageId) }, [stageId])

  // A stale gate message must not follow the learner to the next screen.
  useEffect(() => { setNotice(null) }, [stageId])

  const revisit = useSim((st) => st.revisit)
  useEffect(() => {
    if (revisit === 'height' || revisit === 'downtilt') setStageId(revisit)
  }, [revisit])

  // Stable identities, for the same reason App.jsx gives for its own handlers.
  // These feed the canvas's readiness effect dependency array, and onReady
  // calls setModelReady. As inline arrows they got a new identity on every
  // render, so: effect runs -> store updates -> this component re-renders ->
  // new identity -> effect runs again, without end. That loop starves the R3F
  // render loop, which is what froze the animation mixer mid-clip and left the
  // stage button stuck on "Installing…" - the mixer is advanced from a
  // useFrame subscription, so when the loop stops, so does the clock.
  //
  // useSim.getState() is read inside rather than subscribed to, so [] is
  // genuinely correct here and these never need to change.
  const onCanvasReady = useCallback((extras, root, controller) => {
    const st = useSim.getState()
    st.setController(controller)
    st.setModelReady(true, root)
  }, [])

  const onCanvasError = useCallback((m) => {
    useSim.getState().setLoadError(m)
  }, [])

  const runStage = useCallback(async () => {
    if (busy) return
    const idx = stageIndex(stageId)

    if (stageId === 'complete') { onComplete?.(); return }

    /**
     * The rig stages take whatever the learner sets.
     *
     * They used to refuse anything outside the target band and name the
     * correct range in the refusal, which meant the learner could not reach
     * the corridor test with a wrong pole — and could read the answer off the
     * refusal. Both are gone. A cell mounted at 4 m with no downtilt is built
     * exactly as specified, and the corridor test is where that turns out to
     * have been the wrong call.
     *
     * A learner sent here by the test's debrief goes straight back to it.
     */
    setNotice(null)
    if (stage.control && useSim.getState().revisit === stage.control) {
      useSim.getState().resumeFromRevision()
      return
    }

    if (!stage.clip) {                       // overview -> first real stage
      setStageId(STAGES[idx + 1].id)
      return
    }

    setBusy(true)
    try {
      const controller = useSim.getState().controller
      if (!controller) throw new Error('Animation controller not ready')
      await controller.playOnce(stage.clip,
        { timeScale: useSim.getState().reducedMotion ? 2 : 1 })
      // Both halves of "this step is done": the title, for the review, and the
      // clip, which is what the model derives the installed hardware from.
      // Without the second the part is only in place until the next remount.
      useSim.getState().noteStageComplete(stage.title)
      useSim.getState().noteClipComplete(stage.clip)
      // s6: only advance once the animation has clearly completed
      setStageId(STAGES[Math.min(idx + 1, STAGES.length - 1)].id)
    } catch (err) {
      console.error('[LP12] stage failed:', err)
    } finally {
      setBusy(false)
    }
  }, [busy, stageId, stage, onComplete])

  const toggleOrbit = useCallback(() => {
    setOrbitOn((was) => {
      const next = !was
      orbitInput.setEnabled(next)
      setView(next ? 'orbit' : 'front')
      return next
    })
  }, [orbitInput])

  // Specification 2.3 / 6: orbit off first, then the isolation transition —
  // the city must not fade out from under a camera the wheel is still turning.
  const beginInstallation = useCallback(() => {
    setOrbitOn(false)
    orbitInput.setEnabled(false)
    runStage()
  }, [orbitInput, runStage])

  /**
   * One drop, judged.
   *
   * The refusal is the teaching moment and the score is counting it, so both
   * live here rather than in the page: every install page performs the same
   * judgement, and a second copy of it in each one is a second place for the
   * penalty to be forgotten.
   */
  const [refusal, setRefusal] = useState(null)
  useEffect(() => { setRefusal(null) }, [stageId])
  useEffect(() => {
    if (!refusal) return undefined
    const t = setTimeout(() => setRefusal(null), 3200)
    return () => clearTimeout(t)
  }, [refusal])

  const attemptPart = useCallback((id) => {
    if (busy) return
    if (id === stage.activePart) { runStage(); return }
    const needed = PART_ORDER[PART_ORDER.indexOf(id) - 1]
    const reason = installed.includes(id)
      ? `${PART_LABELS[id]} is already installed.`
      : PART_PREREQ_MESSAGE[id] || `Install the ${PART_LABELS[needed]} first.`
    useSim.getState().noteWrongAttempt()
    // A counter, not a bare string: the same refusal twice running is the same
    // value, and the dismissal timer above would never re-arm.
    setRefusal({ text: reason, n: (refusal?.n ?? 0) + 1 })
  }, [busy, stage.activePart, installed, runStage, refusal])

  /**
   * One step back through the installation.
   *
   * Nothing has to be undone by hand: the pose, the visible parts and the
   * installed list are all derived from `stageId`, so moving it is the whole
   * operation. Scoring is safe too — `noteStageComplete` dedupes on title, so
   * redoing a stage cannot count it twice.
   *
   * From the first stage this leaves the installation altogether and returns
   * the learner to the site.
   */
  const goBack = () => {
    if (busy) return
    const idx = stageIndex(stageId)
    if (idx === 0) onExit?.()
    else setStageId(STAGES[idx - 1].id)
  }

  // completed clips drive part visibility, so the canvas keeps its contract
  const completedClips = STAGES.filter((st) =>
    st.clip && stageIndex(st.id) < stageIndex(stageId)).map((st) => st.clip)

  const canvas = (
      <Suspense fallback={null}>
        <LP12BuildCanvas
          orbitInput={orbitInput}
          /* Environment visibility per specification 4. The overview keeps the
             street as a softened plate behind the model rather than as
             geometry, and the assembly and rig stages have none at all; the
             city comes back for the coverage pages, where it is the
             consequence being shown. */
          showEnvironment={stageId === 'coverage' || stageId === 'complete'}
          /* Where this stage's component belongs on the column. The stage
             table already carries it as the position tracker's window. */
          targetRegion={stage.clip ? stage.tracker : null}
          hideCallouts={REDESIGNED_STAGES.includes(stageId)}
          flow={flow} studio={studio} look={look}
          installedParts={installed}
          stage={stageId} view={view}
          camera={STAGE_CAMERA[stageId]}
          height={s.height} downtilt={s.downtilt}
          /* Dome turns green and starts pulsing only once BOTH rig
             settings are within target — the same pass/fail the stage
             gates enforce, expressed as a property of the coverage. */
          rigSettled={s.heightOk() && s.tiltOk()}
          completedClips={completedClips}
          activeClip={busy ? stage.clip : null}
          modelRoot={s.modelRoot}
          selectedNames={[]}
          focusNodeName={null}
          focusMode={false}
          performanceTier={s.performanceTier}
          reducedMotion={s.reducedMotion}
          rigRevision={s.rigRevision}
          onReady={onCanvasReady}
          onError={onCanvasError}
        />
      </Suspense>
  )

  /**
   * Every redesigned page gets the same back control, in the same place.
   *
   * It is rendered here rather than passed into each page because it is fixed
   * to the viewport — its position in the tree is irrelevant — and because
   * threading an onBack prop through six page components would put a
   * navigation concern into six specs that do not mention one.
   */
  const withBack = (node) => (
    <>
      {node}
      <BackButton onBack={goBack} busy={busy} />
    </>
  )

  // The overview is Page 04 of the redesign and owns its own chrome; the
  // assembly stages still run through the shell until their pages are built.
  if (stageId === 'overview') {
    return withBack(
      <Page04PoleOverview
        onBeginInstallation={beginInstallation}
        busy={busy}
      >
        {canvas}
      </Page04PoleOverview>
    )
  }

  /* Pages 05-10 share one shell. Enabled a step at a time, in step order, so
     an unbuilt page cannot be reached before it has been through its gate. */
  if (ASSEMBLY_PAGES.includes(stageId)) {
    return withBack(
      <AssemblyStagePage
        step={String(INSTALL_STEP_OF[stageId]).padStart(2, '0')}
        steps={String(INSTALL_STEP_COUNT).padStart(2, '0')}
        title={stage.title}
        /* The specification's line, not the stage table's. STAGE_INSTRUCTION
           says "Drag the pole bands onto the pole" — which names the component
           the unlabelled tray is asking the learner to recognise, and answers
           the only question the page poses. */
        helper="Drag the correct component onto the pole." 
        cards={stage.cards}
        activePart={stage.activePart}
        busy={busy}
        feedback={refusal?.text || null}
        onAttempt={attemptPart}
      >
        {canvas}
      </AssemblyStagePage>
    )
  }

  if (stageId === 'height') {
    const l = s.limits
    return withBack(
      <Page11SetMountHeight
        value={s.height}
        min={l.mount_height_min}
        max={l.mount_height_max}
        step={l.mount_height_step}
        onChange={useSim.getState().setHeight}
        onConfirm={runStage}
        notice={notice}
        busy={busy}
      >
        {canvas}
      </Page11SetMountHeight>
    )
  }

  if (stageId === 'downtilt') {
    const l = s.limits
    return withBack(
      <Page12SetDowntilt
        value={s.downtilt}
        min={0}
        max={10}
        step={1}
        target={l.downtilt_correct}
        heightM={s.height}
        onChange={useSim.getState().setDowntilt}
        onConfirm={runStage}
        notice={notice}
        busy={busy}
      >
        {canvas}
      </Page12SetDowntilt>
    )
  }

  if (stageId === 'coverage') {
    return withBack(
      <Page13NetworkCoverage
        orbitInput={orbitInput}
        orbitEnabled={orbitOn}
        onOrbit={toggleOrbit}
        onContinue={runStage}
        busy={busy}
      >
        {canvas}
      </Page13NetworkCoverage>
    )
  }

  if (stageId === 'complete') {
    return withBack(
      <Page14InstallationComplete
        height={s.height}
        downtilt={s.downtilt}
        onContinue={runStage}
        busy={busy}
      >
        {canvas}
      </Page14InstallationComplete>
    )
  }

  return (
    <InstallShell
      stageId={stageId} busy={busy} view={view} onView={setView}
      onAction={runStage} onBack={goBack} installed={installed}
      notice={notice}
    >
      {canvas}
    </InstallShell>
  )
}
