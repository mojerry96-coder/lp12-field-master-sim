import { useEffect, useRef, useState } from 'react'
import DowntiltKnob from './DowntiltKnob'
import {
  STAGES, PART_LABELS, PART_ORDER, PART_PREREQ_MESSAGE,
  stageIndex, stageById, COMPLETED_PART_BY_STAGE,
} from '../lib/installationStages'
import { useSim } from '../store'

/* ---------------------------------------------------------------- tool rail */
const RAIL_ICONS = {
  install: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15 9l-2.2 4.8L8 16l2.2-4.8z',
}

/* STAGES is overview + the installable steps + complete, so the index is not
 * the step number at either end. The count is derived from the stages that
 * actually carry a clip rather than written as a literal, so adding or
 * removing an install step cannot leave the denominator stale. */
const INSTALL_STEPS = STAGES.filter((s) => s.clip).length

/* Stages after the last install step are not numbered — they are named. */
const TAIL_LABEL = { height: 'Height', downtilt: 'Downtilt',
                     coverage: 'Coverage', complete: 'Complete' }

function stageCounterLabel(idx, id) {
  if (idx <= 0) return 'Overview'
  if (idx > INSTALL_STEPS) return TAIL_LABEL[id] || 'Complete'  // was "Step 7 of 6"
  return `Step ${idx} of ${INSTALL_STEPS}`
}

function RailButton({ id, active, label }) {
  return (
    <button className={`rail-btn cursor-target ${active ? 'is-active' : ''}`}
            type="button" aria-label={label} aria-pressed={active} disabled={!active}>
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none"
           stroke="currentColor" strokeWidth="1.6"
           strokeLinecap="round" strokeLinejoin="round">
        <path d={RAIL_ICONS[id]} />
      </svg>
    </button>
  )
}

function ToolRail() {
  return (
    /* Only the control that does something. Network view, Reports, Cloud sync,
       Upload and Settings were all rendered permanently disabled — five
       controls that can never be used, which is worse than no rail at all:
       they read as features that are broken rather than absent. */
    <nav className="tool-rail" aria-label="Workspace tools">
      <div className="rail-group">
        <RailButton id="install" label="Installation workspace" active />
      </div>
    </nav>
  )
}

/* ------------------------------------------------------- position tracker */
function PositionTracker({ rect }) {
  return (
    <div className="position-tracker" aria-hidden="true">
      <img src="/lp12/wireframes/00_overview.png" alt="" className="tracker-pole" />
      <div className="tracker-window"
           style={{ top: `${rect.top}%`, height: `${rect.height}%` }} />
    </div>
  )
}

/* ------------------------------------------------------------ view toggle */
function ViewToggle({ view, onChange, disabled }) {
  return (
    <div className="view-toggle" role="group" aria-label="Camera view">
      {/* Orbit is a third camera VIEW, not a mode: it reuses the same target
          the stage camera is already framing, so it works on every stage and
          leaves the model untouched (s11: rotate the camera, never the
          model). Not disabled during a clip — watching the install turn is
          the point of having it. */}
      {['front', 'side', 'orbit'].map((v) => (
        <button key={v} type="button"
                className={`cursor-target ${view === v ? 'is-active' : ''}`}
                aria-pressed={view === v}
                disabled={disabled && v !== 'orbit'}
                onClick={() => onChange(v)}>
          {v === 'front' ? 'Front' : v === 'side' ? 'Side' : 'Orbit'}
        </button>
      ))}
    </div>
  )
}

/* --------------------------------------------------------- parts carousel */
function PartsCarousel({ cards, activePart, installed, onSelect, shakeId,
                        onDragPart, dragging }) {
  if (!cards.length) return null
  return (
    <>
      <h3 className="panel-section">Available Parts</h3>
      <div className="parts-row">
        {cards.map((id) => {
          const done = installed.includes(id)
          return (
            <button key={id} type="button"
                    className={`part-card cursor-target${id === activePart ? ' is-selected' : ''}`
                               + (done ? ' is-done' : '') + (shakeId === id ? ' is-shake' : '')
                               + (dragging === id ? ' is-dragging' : '')}
                    aria-pressed={id === activePart}
                    /* Every card drags, not only the correct one. Letting the
                       wrong part be picked up and refused at the drop is the
                       teaching moment; making it undraggable just hides the
                       ordering rule the stage exists to teach. */
                    draggable={!done}
                    onDragStart={(e) => onDragPart?.(id, e)}
                    onDragEnd={() => onDragPart?.(null)}
                    onClick={() => onSelect(id)}>
              <img src={`/lp12/parts/${id}.png`} alt="" />
              <span>{PART_LABELS[id]}</span>
              {done && <i className="part-tick" aria-hidden="true">✓</i>}
            </button>
          )
        })}
      </div>
    </>
  )
}

/* ----------------------------------------------------------- rig controls */
/**
 * Mount height and downtilt.
 *
 * Both drive the model directly — Height_Rig.position.y and
 * Tilt_Rig.rotation.x — and both are validated against the manifest's correct
 * ranges, so the readout tells the learner whether the setting is right rather
 * than only what it is. The coverage dome reads the same two values, so moving
 * either of these visibly changes the footprint two stages later.
 */
function RigControl({ kind, disabled }) {
  const s = useSim()
  const lim = s.limits

  if (kind === 'height') {
    const ok = s.heightOk()
    return (
      <div className="panel-control">
        <label htmlFor="mount-height">Mount height</label>
        <input id="mount-height" type="range" className="cursor-target"
               min={lim.mount_height_min} max={lim.mount_height_max}
               step={lim.mount_height_step} value={s.height} disabled={disabled}
               onChange={(e) => s.setHeight(parseFloat(e.target.value))} />
        <div className="panel-control-readout">
          <b className={ok ? 'is-ok' : 'is-warn'}>{s.height.toFixed(1)} m</b>
          <span>{ok ? 'within target' :
            `target ${lim.mount_height_correct_min}–${lim.mount_height_correct_max} m`}</span>
        </div>
      </div>
    )
  }

  // Downtilt is turned, not picked from a list — see DowntiltKnob.
  return (
    <DowntiltKnob
      value={s.downtilt}
      min={lim.downtilt_min ?? 0}
      max={lim.downtilt_max ?? 10}
      target={lim.downtilt_correct}
      disabled={disabled}
      onChange={s.setDowntilt}
    />
  )
}

/* ------------------------------------------------------------------ shell */
export default function InstallShell({
  stageId, busy, view, onView, onAction, onBack, installed, notice, children,
}) {
  const stage = stageById(stageId)
  const idx = stageIndex(stageId)
  const [shakeId, setShakeId] = useState(null)
  const [warning, setWarning] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [over, setOver] = useState(false)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  // s8 wrong-order feedback: never advance, shake the card, show a short
  // message where the secondary status normally sits, clear after ~2.5 s.
  const selectPart = (id) => {
    if (busy) return
    if (id === stage.activePart) return
    const needed = PART_ORDER[PART_ORDER.indexOf(id) - 1]
    // Recorded for the performance review. The learner is not penalised for
    // it in the moment — the refusal already teaches the order — but the
    // review is more useful when it can say how often it happened.
    useSim.getState().noteWrongAttempt()
    setShakeId(id)
    setWarning(PART_PREREQ_MESSAGE[id] || `Install the ${PART_LABELS[needed]} first.`)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { setShakeId(null); setWarning(null) }, 2500)
  }

  const done = stageId === 'complete'

  /* --- drag and drop ------------------------------------------------------
     The parts are physical components and the model is the pole: carrying one
     to the other is the gesture the stage is describing. A click on a card
     only ever selected it — the install still had to be triggered from a
     separate button on the far side of the panel. */
  const onDragPart = (id, e) => {
    setDragging(id)
    if (!e) return
    e.dataTransfer.effectAllowed = 'move'
    // A payload is required or Safari cancels the drag before it starts.
    e.dataTransfer.setData('text/plain', id)
  }

  const onDragOver = (e) => {
    if (!dragging || busy) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!over) setOver(true)
  }

  const onDrop = (e) => {
    e.preventDefault()
    const id = dragging || e.dataTransfer.getData('text/plain')
    setOver(false)
    setDragging(null)
    if (!id || busy) return
    // Correct part: run the stage. Wrong part: the same refusal a wrong click
    // gets, so there is one rule and one message rather than two.
    if (id === stage.activePart) onAction?.()
    else selectPart(id)
  }

  return (
    <div className="installation-shell">
      <ToolRail />

      <aside className="info-panel">
        <button className="panel-back cursor-target" type="button" onClick={onBack}>
          <span aria-hidden="true">‹</span> Back
        </button>
        <p className="panel-eyebrow">LP12 Installation</p>
        <h1 className="panel-title">{stage.title}</h1>

        <img className="panel-hero"
             src={stage.activePart ? `/lp12/parts/${stage.activePart}.png`
                                   : '/lp12/wireframes/07_complete.png'}
             alt="" />

        <p className="panel-status"><span className="dot" aria-hidden="true" /> Online</p>

        <button className="panel-cta cursor-target" type="button"
                onClick={onAction} disabled={busy}>
          {busy ? 'Installing…' : stage.action}
        </button>

        {stage.control && <RigControl kind={stage.control} disabled={busy} />}

        <div className={`panel-secondary${warning || notice ? ' is-warning' : ''}`}>
          {warning || notice || stage.status}
        </div>

        <div className="panel-wire">
          <img src={stage.wireframe} alt="" />
        </div>
        <p className="panel-location">LP12 / Awolowo Way</p>

        {done ? (
          <ul className="complete-list">
            {Object.values(COMPLETED_PART_BY_STAGE).map((p) => (
              <li key={p}><i aria-hidden="true">✓</i> {PART_LABELS[p]}</li>
            ))}
          </ul>
        ) : (
          <PartsCarousel cards={stage.cards} activePart={stage.activePart}
                         installed={installed} onSelect={selectPart} shakeId={shakeId}
                         onDragPart={onDragPart} dragging={dragging} />
        )}
      </aside>

      <main
        className={`viewport${dragging ? ' is-drop-armed' : ''}${over ? ' is-drop-over' : ''}`}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {children}
        <PositionTracker rect={stage.tracker} />
        <ViewToggle view={view} onChange={onView} disabled={busy} />
        <div className="stage-counter">{stageCounterLabel(idx, stageId)}</div>
        {dragging && (
          <div className="drop-hint" aria-hidden="true">
            <span className={`drop-hint-pill${over ? ' is-over' : ''}`}>
              {dragging === stage.activePart
                ? 'Release to install'
                : `${PART_LABELS[dragging]} is not next`}
            </span>
          </div>
        )}
      </main>
    </div>
  )
}
