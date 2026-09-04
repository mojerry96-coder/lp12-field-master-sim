import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PART_LABELS } from '../lib/installationStages'

/**
 * The assembly workspace — PAGES 05-10.
 *
 * One component, not one per step. The specification is explicit from Page 06
 * on: "identical shell to Page 05. Do not redesign the page. Only the stage
 * number, title, target geometry, installed hardware state and tray contents
 * change." Every one of those already lives in the stage table, so a second
 * copy of this file per step would be five more places for the shell to drift
 * from itself.
 *
 * The city is gone from here: warm-white to cool-white ground, the pole
 * isolated on it, and three things over the top — the instruction, the target
 * region on the column, and the tray.
 *
 * The tiles carry no VISIBLE names and no marking (they do carry an accessible
 * name, for the reason set out at the aria-label below). The stage title says which
 * component the step wants; recognising it among the wrong ones is the thing
 * being assessed (specification 2.5), and every hint removed is a hint the
 * learner has to replace with knowledge. A caption answered the question
 * outright; a highlight on the correct tile answered it just as completely,
 * and position answered it a third time — the stage table happens to list the
 * right component first at every step, so "always press the left one" beat the
 * exercise without reading anything. All three are gone.
 *
 * Wrong attempts are scored, so guessing has a price rather than a tell.
 *
 * Every offered tile drags, including the wrong ones (2.6). A refused drop
 * teaches the dependency order; an undraggable tile just hides it, and the
 * refusal is also what the score is counting.
 */
/**
 * A stable, stage-specific order.
 *
 * Deterministic so the tray cannot reshuffle under a drag — the order is fixed
 * for the whole step — but different from step to step, so the correct tile is
 * never in a learned position. Seeded from the step's own title, which is the
 * one thing that is unique per step and does not change while it is on screen.
 */
function shuffleForStep(cards, seedText) {
  let seed = 0
  for (let i = 0; i < seedText.length; i += 1) {
    seed = (seed * 31 + seedText.charCodeAt(i)) % 2147483647
  }
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const out = [...cards]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export default function AssemblyStagePage({
  step, steps, title, helper, cards, activePart, busy, feedback,
  onAttempt, children,
}) {
  const order = useMemo(() => shuffleForStep(cards, title), [cards, title])
  const [dragging, setDragging] = useState(null)
  const [over, setOver] = useState(false)
  const liveRef = useRef(null)

  // A refusal from the previous stage must not follow the learner here.
  useEffect(() => { setDragging(null); setOver(false) }, [activePart])

  const onDragStart = useCallback((id, e) => {
    if (busy) return
    setDragging(id)
    // A payload is required or Safari cancels the drag before it starts.
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }, [busy])

  const onDragOver = (e) => {
    if (!dragging || busy) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOver(true)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setOver(false)
    const id = e.dataTransfer.getData('text/plain') || dragging
    setDragging(null)
    if (id) onAttempt(id)
  }

  return (
    <section
      className={`fm-page fm-studio as-page${over ? ' is-over' : ''}`}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {/* The live model, full bleed. Everything else is over it. */}
      <div className="as-viewport">{children}</div>

      <div className="as-instruction">
        <p className="as-step"><b>{step}</b> / {steps}</p>
        <h1 className="fm-stage-title as-title">{title}</h1>
        <p className="fm-helper as-helper">{helper}</p>
      </div>

      <div className="fm-glass as-tray">
        {order.map((id) => (
          <button
            key={id}
            type="button"
            draggable={!busy}
            className={`as-part${dragging === id ? ' is-dragging' : ''}`}
            /* Named, because the tile IS its name to anyone who can see it.
               These were numbered — "Component 1 of 3" — on the reasoning that
               naming them would hand a screen reader user an answer the page
               withholds from everyone else. It withholds no such thing: the
               tile is a photograph of the hardware, and recognising the
               hardware is precisely what the sighted learner does to choose.
               A number conveys none of that, so the exercise went from "which
               of these three parts comes next" to "guess one of three", which
               is not the same exercise made fair, it is no exercise at all.
               The name identifies the option; which option is CORRECT is still
               the thing being asked, and is still withheld from everybody. */
            aria-label={`${PART_LABELS[id] || id}, component ${order.indexOf(id) + 1} of ${order.length}`}
            onDragStart={(e) => onDragStart(id, e)}
            onDragEnd={() => setDragging(null)}
            onClick={() => onAttempt(id)}
          >
            <img src={`/lp12/parts/${id}.webp`} alt="" width={100} height={100}
                 draggable={false} decoding="async" />
          </button>
        ))}
      </div>

      {feedback && (
        <div className="fm-glass as-feedback" role="alert">{feedback}</div>
      )}

      {/* Announced rather than drawn: the refusal above is visual, and a
          learner using a screen reader needs the same information. */}
      <p ref={liveRef} className="sr-live" aria-live="polite">
        {busy ? 'Installing' : feedback || ''}
      </p>
    </section>
  )
}
