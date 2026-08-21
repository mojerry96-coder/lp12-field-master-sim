import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSim } from './store'
import InstallShell from './components/InstallShell'
import LP12BuildCanvas from './components/LP12BuildCanvas'
import {
  STAGES, stageIndex, stageById, COMPLETED_PART_BY_STAGE, STAGE_CAMERA,
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
export default function InstallationPage({ studio, flow, onExit, onComplete }) {
  const s = useSim()
  const [stageId, setStageId] = useState('overview')
  const [view, setView] = useState('front')
  const [busy, setBusy] = useState(false)
  const [installed, setInstalled] = useState([])
  const [notice, setNotice] = useState(null)

  const stage = stageById(stageId)

  // s11.9: each new part is presented Front first.
  useEffect(() => { setView('front') }, [stageId])

  // A stale gate message must not follow the learner to the next screen.
  useEffect(() => { setNotice(null) }, [stageId])

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

    // Rig-setting stages gate on being correct. This is the teaching mechanic:
    // the model will happily sit at 4 m and 0 deg, and letting that through
    // would make the two controls decorative. The message names the target
    // rather than just refusing.
    if (stage.control === 'height' && !useSim.getState().heightOk()) {
      const l = useSim.getState().limits
      setNotice(`Mount height must be ${l.mount_height_correct_min}–`
                + `${l.mount_height_correct_max} m for this site.`)
      return
    }
    if (stage.control === 'downtilt' && !useSim.getState().tiltOk()) {
      setNotice(`Downtilt must be ${useSim.getState().limits.downtilt_correct}° `
                + 'for this site.')
      return
    }
    setNotice(null)

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
      const part = COMPLETED_PART_BY_STAGE[stageId]
      if (part) setInstalled((prev) => prev.includes(part) ? prev : [...prev, part])
      // s6: only advance once the animation has clearly completed
      setStageId(STAGES[Math.min(idx + 1, STAGES.length - 1)].id)
    } catch (err) {
      console.error('[LP12] stage failed:', err)
    } finally {
      setBusy(false)
    }
  }, [busy, stageId, stage, onComplete])

  const goBack = () => {
    if (busy) return
    const idx = stageIndex(stageId)
    if (idx === 0) onExit?.()
    else setStageId(STAGES[idx - 1].id)
  }

  // completed clips drive part visibility, so the canvas keeps its contract
  const completedClips = STAGES.filter((st) =>
    st.clip && stageIndex(st.id) < stageIndex(stageId)).map((st) => st.clip)

  return (
    <InstallShell
      stageId={stageId} busy={busy} view={view} onView={setView}
      onAction={runStage} onBack={goBack} installed={installed}
      notice={notice}
    >
      <Suspense fallback={null}>
        <LP12BuildCanvas
          flow={flow} studio={studio}
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
    </InstallShell>
  )
}
