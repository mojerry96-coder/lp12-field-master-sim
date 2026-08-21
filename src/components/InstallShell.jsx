import { useEffect, useRef, useState } from 'react'
import {
  STAGES, PART_LABELS, PART_ORDER, PART_PREREQ_MESSAGE,
  stageIndex, stageById, COMPLETED_PART_BY_STAGE, DOWNTILT_STEPS,
} from '../lib/installationStages'
import { useSim } from '../store'

/* ---------------------------------------------------------------- tool rail */
const RAIL_ICONS = {
  network: 'M12 3v5m0 8v5M5 12h5m4 0h5M8 8a2 2 0 1 0 0-.01M16 8a2 2 0 1 0 0-.01M8 16a2 2 0 1 0 0-.01M16 16a2 2 0 1 0 0-.01',
  reports: 'M4 5h16v14H4zM9 9v6M15 9v6',
  install: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15 9l-2.2 4.8L8 16l2.2-4.8z',
  cloud:   'M7 18h10a4 4 0 0 0 .3-8 6 6 0 0 0-11.5 1.6A3.5 3.5 0 0 0 7 18z',
  upload:  'M12 16V6m0 0-3.5 3.5M12 6l3.5 3.5M5 18h14',
  settings:'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
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
    <nav className="tool-rail" aria-label="Workspace tools">
      <div className="rail-group">
        <RailButton id="network" label="Network view" />
        <RailButton id="reports" label="Reports" />
        <RailButton id="install" label="Installation workspace" active />
        <RailButton id="cloud" label="Cloud sync" />
        <RailButton id="upload" label="Upload" />
      </div>
      <RailButton id="settings" label="Settings" />
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
      {['front', 'side'].map((v) => (
        <button key={v} type="button"
                className={`cursor-target ${view === v ? 'is-active' : ''}`}
                aria-pressed={view === v} disabled={disabled}
                onClick={() => onChange(v)}>
          {v === 'front' ? 'Front' : 'Side'}
        </button>
      ))}
    </div>
  )
}

/* --------------------------------------------------------- parts carousel */
function PartsCarousel({ cards, activePart, installed, onSelect, shakeId }) {
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
                               + (done ? ' is-done' : '') + (shakeId === id ? ' is-shake' : '')}
                    aria-pressed={id === activePart}
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

  const ok = s.tiltOk()
  return (
    <div className="panel-control">
      <label>Downtilt</label>
      <div className="tilt-steps">
        {DOWNTILT_STEPS.map((d) => (
          <button key={d} type="button" disabled={disabled}
                  className={`cursor-target${s.downtilt === d ? ' is-on' : ''}`}
                  aria-pressed={s.downtilt === d}
                  onClick={() => s.setDowntilt(d)}>{d}°</button>
        ))}
      </div>
      <div className="panel-control-readout">
        <b className={ok ? 'is-ok' : 'is-warn'}>{s.downtilt}°</b>
        <span>{ok ? 'within target' : `target ${lim.downtilt_correct}°`}</span>
      </div>
    </div>
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
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  // s8 wrong-order feedback: never advance, shake the card, show a short
  // message where the secondary status normally sits, clear after ~2.5 s.
  const selectPart = (id) => {
    if (busy) return
    if (id === stage.activePart) return
    const needed = PART_ORDER[PART_ORDER.indexOf(id) - 1]
    setShakeId(id)
    setWarning(PART_PREREQ_MESSAGE[id] || `Install the ${PART_LABELS[needed]} first.`)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { setShakeId(null); setWarning(null) }, 2500)
  }

  const done = stageId === 'complete'

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
                         installed={installed} onSelect={selectPart} shakeId={shakeId} />
        )}
      </aside>

      <main className="viewport">
        {children}
        <PositionTracker rect={stage.tracker} />
        <ViewToggle view={view} onChange={onView} disabled={busy} />
        <div className="stage-counter">{stageCounterLabel(idx, stageId)}</div>
      </main>
    </div>
  )
}
