import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CaretLeft, CheckCircle, WarningCircle, HandGrabbing, ArrowDown,
  FlagCheckered, Cube,
} from '@phosphor-icons/react'
import DowntiltKnob from './DowntiltKnob'
import {
  STAGES, PART_LABELS, PART_ORDER, PART_PREREQ_MESSAGE, STAGE_INSTRUCTION,
  PART_DESCRIPTION, PART_PLACEMENT,
  stageIndex, stageById, COMPLETED_PART_BY_STAGE,
} from '../lib/installationStages'
import { useSim } from '../store'


/* The workspace rail is gone. It had been reduced to a single icon that only
 * ever indicated the page you were already on — a column of chrome buying no
 * capability, so the panel now starts at the left edge of the window. */

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

/* The tray is shuffled so the correct card is never in a learned position.
 * Deterministic per stage: a hash of the stage id seeds the shuffle, so the
 * order is stable for the whole stage (cards cannot move under a drag) but
 * different from the stage before it. */
function shuffledParts(stageId) {
  let seed = 0
  for (let i = 0; i < stageId.length; i++) seed = (seed * 31 + stageId.charCodeAt(i)) % 100000
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const out = [...PART_ORDER]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
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

/* ------------------------------------------------------------ part preview */
/**
 * The panel had a dead band of blue between the brief and the tray. Selecting
 * a card now fills it with the component itself: the studio render at a size
 * you can actually read, what it is, where it goes, and whether it is the one
 * the stage wants. Purely informational — it changes no drag rule.
 */
const PartPreview = memo(function PartPreview({ partId, activePart, installed }) {
  if (!partId) return null
  const done = installed.includes(partId)
  const isNext = partId === activePart && !done
  const state = done ? 'Already installed'
    : isNext ? 'Next up — drag it into the scene'
    : PART_PREREQ_MESSAGE[partId] || 'Not the next component.'

  return (
    <figure className={`part-preview${done ? ' is-done' : isNext ? ' is-next' : ' is-blocked'}`}>
      <img src={`/lp12/parts/${partId}.webp`} alt={PART_LABELS[partId]}
           width={320} height={320} decoding="async" />
      <figcaption>
        <b>{PART_LABELS[partId]}</b>
        <span className="part-preview-desc">{PART_DESCRIPTION[partId]}</span>
        <span className="part-preview-where">{PART_PLACEMENT[partId]}</span>
        <span className="part-preview-state">
          {done ? <CheckCircle size={14} weight="fill" aria-hidden="true" />
                : isNext ? <HandGrabbing size={14} aria-hidden="true" />
                : <WarningCircle size={14} weight="fill" aria-hidden="true" />}
          {state}
        </span>
      </figcaption>
    </figure>
  )
})

/* -------------------------------------------------------------- parts grid */
/**
 * Every component, always visible, in one shuffled 3-column tray pinned to
 * the bottom of the panel. The per-stage 3-card rotation hid the parts the
 * learner had not reached yet; showing all six, in an order that changes each
 * stage, means the correct card has to be recognised rather than remembered
 * by position.
 *
 * Memoised: a drag, a warning or a rig tweak re-renders the shell several
 * times a second, and none of those touch these six cards.
 */
const PartsGrid = memo(function PartsGrid({ order, activePart, installed, onSelect,
                                            shakeId, selected, onDragPart, dragging }) {
  return (
    <div className="parts-tray">
      <h3 className="panel-section">Components</h3>
      <div className="parts-grid">
        {order.map((id) => {
          const done = installed.includes(id)
          const active = selected ? id === selected : (id === activePart && !done)
          return (
            <button key={id} type="button"
                    className={`part-card cursor-target${active ? ' is-selected' : ''}`
                               + (done ? ' is-done' : '') + (shakeId === id ? ' is-shake' : '')
                               + (dragging === id ? ' is-dragging' : '')}
                    aria-pressed={active}
                    /* Every card drags, not only the correct one. Letting the
                       wrong part be picked up and refused at the drop is the
                       teaching moment; making it undraggable just hides the
                       ordering rule the stage exists to teach. */
                    draggable={!done}
                    onDragStart={(e) => onDragPart?.(id, e)}
                    onDragEnd={() => onDragPart?.(null)}
                    onClick={() => onSelect(id)}>
              <span className="part-thumb">
                <img src={`/lp12/parts/${id}.webp`} alt="" width={96} height={96}
                     loading="lazy" decoding="async" />
              </span>
              <span className="part-name">{PART_LABELS[id]}</span>
              {done
                ? <CheckCircle className="part-tick" size={20} weight="fill" aria-hidden="true" />
                : active && <HandGrabbing className="part-drag" size={16} aria-hidden="true" />}
            </button>
          )
        })}
      </div>
    </div>
  )
})


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
  /* {msg, n} rather than a bare string: the same refusal twice in a row is the
     same string, and a bare string would not change state, so the dismissal
     timer below would never re-arm and the second warning would inherit the
     first one's remaining time — which is how it could vanish a frame after
     appearing. The counter makes every refusal a new value. */
  const [warning, setWarning] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [over, setOver] = useState(false)
  const [selected, setSelected] = useState(null)
  const seq = useRef(0)

  // Reshuffled once per stage, never mid-stage: a tray that reorders while a
  // card is being dragged would move the target out from under the pointer.
  const order = useMemo(() => shuffledParts(stageId), [stageId])

  // A selection from the previous stage must not describe this one.
  useEffect(() => { setSelected(null) }, [stageId])

  // Owned by the warning itself, so the timer cannot outlive or precede the
  // message it belongs to.
  useEffect(() => {
    if (!warning) return undefined
    const t = setTimeout(() => { setWarning(null); setShakeId(null) }, 3200)
    return () => clearTimeout(t)
  }, [warning])

  // s8 wrong-order feedback: never advance, shake the card, say why on the
  // viewport itself, clear after ~3 s. Every click also previews the part —
  // being told a component is wrong is more useful when you can see what it is.
  const selectPart = useCallback((id) => {
    if (busy) return
    setSelected(id)
    if (id === stage.activePart) return
    const needed = PART_ORDER[PART_ORDER.indexOf(id) - 1]
    const reason = installed.includes(id)
      ? `${PART_LABELS[id]} is already installed.`
      : PART_PREREQ_MESSAGE[id] || `Install the ${PART_LABELS[needed]} first.`
    // Recorded for the review AND scored: every wrong drag or click costs
    // points, so the ordering rule has a consequence beyond the refusal.
    useSim.getState().noteWrongAttempt()
    setShakeId(id)
    seq.current += 1
    setWarning({ msg: reason, n: seq.current })
  }, [busy, stage.activePart, installed])


  const done = stageId === 'complete'

  /* --- drag and drop ------------------------------------------------------
     The parts are physical components and the model is the pole: carrying one
     to the other is the gesture the stage is describing. A click on a card
     only ever selected it — the install still had to be triggered from a
     separate button on the far side of the panel. */
  // Stable, so the memoised tray does not re-render on every shell update.
  const onDragPart = useCallback((id, e) => {
    setDragging(id)
    if (id) setSelected(id)
    if (!e) return
    e.dataTransfer.effectAllowed = 'move'
    // A payload is required or Safari cancels the drag before it starts.
    e.dataTransfer.setData('text/plain', id)
  }, [])

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

  const stepTag = idx > 0 && idx <= INSTALL_STEPS
    ? String(idx).padStart(2, '0')
    : null

  /* Drag stages have no action button. Carrying the part to the pole IS the
     command — a button next to it just offers a second way to do the same
     thing and tells the learner they can skip the gesture. Stages without a
     clip (overview, height, downtilt, coverage, complete) are decisions, and
     those keep their button. */
  const showCta = !stage.clip

  return (
    <div className="installation-shell">
      <aside className="info-panel">
        <div className="panel-brief">
          <button className="panel-back cursor-target" type="button" onClick={onBack}>
            <CaretLeft size={18} weight="bold" aria-hidden="true" /> Back
          </button>
          <p className="panel-eyebrow">LP12 Installation</p>
          <h1 className="panel-title">
            {stepTag && <span className="panel-step">{stepTag}</span>}
            {stage.title}
          </h1>
          <p className="panel-instruction">{STAGE_INSTRUCTION[stageId] || stage.status}</p>

          <p className="panel-status"><span className="dot" aria-hidden="true" /> Online</p>

          {showCta ? (
            <button className="panel-cta cursor-target" type="button"
                    onClick={onAction} disabled={busy}>
              {busy ? 'Installing…' : stage.action}
            </button>
          ) : busy ? (
            <div className="panel-busy" role="status">
              <span className="panel-busy-dot" aria-hidden="true" /> Installing…
            </div>
          ) : (
            <div className="panel-dragcue">
              <HandGrabbing size={18} aria-hidden="true" />
              Drag the correct part into the scene
            </div>
          )}

          {stage.control && <RigControl kind={stage.control} disabled={busy} />}

          <div className={`panel-secondary${warning || notice ? ' is-warning' : ''}`}>
            {(warning || notice) &&
              <WarningCircle size={18} weight="fill" aria-hidden="true" />}
            <span>{warning?.msg || notice || stage.status}</span>
          </div>

          {/* The blue band that used to sit empty here. Defaults to the part
              the stage is asking for, so it is never blank. */}
          {!done && (
            <PartPreview partId={selected || stage.activePart}
                         activePart={stage.activePart} installed={installed} />
          )}

          <p className="panel-location">LP12 / Awolowo Way</p>
        </div>

        {done ? (
          <div className="complete-card">
            <CheckCircle size={26} weight="fill" aria-hidden="true" />
            <h3>Assembly Complete</h3>
            <ul className="complete-list">
              {Object.values(COMPLETED_PART_BY_STAGE).map((p) => (
                <li key={p}>
                  <CheckCircle size={16} weight="fill" aria-hidden="true" /> {PART_LABELS[p]}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <PartsGrid order={order} activePart={stage.activePart} selected={selected}
                     installed={installed} onSelect={selectPart} shakeId={shakeId}
                     onDragPart={onDragPart} dragging={dragging} />
        )}
      </aside>

      <main
        className={`viewport${dragging ? ' is-drop-armed' : ''}${over ? ' is-drop-over' : ''}`
                   + (warning ? ' is-drop-error' : '')}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {children}
        <PositionTracker rect={stage.tracker} />
        <ViewToggle view={view} onChange={onView} disabled={busy} />
        <div className="stage-counter">
          {done
            ? <FlagCheckered size={16} weight="fill" aria-hidden="true" />
            : <Cube size={16} aria-hidden="true" />}
          {stageCounterLabel(idx, stageId)}
        </div>

        {/* The refusal belongs where the learner was looking — on the model
            they just dropped a part onto — and it has to say why, not only
            that it was wrong. */}
        {warning && (
          <div className="drop-error" role="alert">
            <WarningCircle size={26} weight="fill" aria-hidden="true" />
            <div>
              <b>Wrong component</b>
              <span>{warning.msg}</span>
            </div>
          </div>
        )}

        {dragging && !warning && (
          <div className="drop-hint" aria-hidden="true">
            <span className={`drop-hint-pill${over ? ' is-over' : ''}`}>
              {dragging === stage.activePart ? (
                <><ArrowDown size={16} weight="bold" /> Release over the scene to install {PART_LABELS[dragging]}</>
              ) : (
                <><WarningCircle size={16} weight="fill" /> {PART_LABELS[dragging]} is not next</>
              )}
            </span>
          </div>
        )}
      </main>
    </div>
  )
}


