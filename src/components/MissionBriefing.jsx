import { useEffect, useMemo, useRef, useState } from 'react'
import { urlFor } from '../lib/assetManifest'

/**
 * Typed mission briefing, between the opener and the site.
 *
 * The simulation used to drop the learner straight onto an isometric map with
 * a pulsing dot and no statement of what they were being asked to do. This
 * says it, in the words a dispatcher would use, and it costs no extra loading
 * time — the P2 band is warming behind it exactly as it did before.
 *
 * It borrows the completion screen's fade deliberately: the same plate at the
 * same scale(1.04), the same 900ms ease-out, the same single sweep. The
 * simulation opens and closes on the same shot of the same street, which is
 * what makes the ending read as a return rather than a different screen.
 *
 * The typing is a real character clock, not a CSS steps() animation on a
 * fixed-width string. steps() needs a monospace font and a known character
 * count, breaks on any reflow, and cannot pause differently at a full stop —
 * which is most of what makes typing read as typing rather than as a wipe.
 */

const LINES = [
  { text: 'Site: Awolowo Way, Ikeja — Lagos.', tone: 'meta' },
  { text: 'Task: install and commission one LP12 small-cell antenna.', tone: 'meta' },
  { text: '' },
  { text: 'Coverage along the corridor has degraded. The replacement mounts on '
        + 'the lighting column at the central median.' },
  { text: '' },
  { text: 'Fit the hardware in order, set mount height and downtilt to spec, '
        + 'then tune the network until coverage and handover hold.' },
  { text: '' },
  { text: 'Every decision is recorded.', tone: 'accent' },
]

/**
 * Timings, set against the clock rather than by feel.
 *
 * The first pass ran ~14 seconds, which is far too long to sit in front of a
 * learner who only wants to start — especially on a second attempt. The copy
 * lost about a quarter of its characters and the clock came down with it, to
 * roughly 7 seconds. "Begin →" is on screen throughout, so nobody who already
 * knows the task has to wait at all.
 */
const CHAR_MS = 11          // base speed
const PAUSE_SENTENCE = 170  // after . or :
const PAUSE_LINE = 200      // between lines
const HOLD_AFTER = 900      // read the last line before handing over

/**
 * Types a list of lines, one after another, and reports when it is done.
 *
 * Returns the number of characters revealed per line so the caller can render
 * real text nodes — the alternative, one long string with a CSS clip, cannot
 * wrap and cannot be read by a screen reader.
 */
function useTypedLines(lines, { enabled, onDone }) {
  const [typed, setTyped] = useState(() => lines.map(() => 0))
  const doneRef = useRef(onDone)

  // Synced in an effect, not during render. Writing a ref while rendering is
  // the "latest value" trick, and it works, but it is a render side effect —
  // and React is free to render without committing.
  useEffect(() => { doneRef.current = onDone }, [onDone])

  // Reduced motion shows everything at once, so the full counts are DERIVED
  // rather than pushed into state by an effect. Setting state on mount just to
  // reach a value that was always knowable costs a second render for nothing.
  const counts = enabled ? typed : lines.map((l) => l.text.length)

  useEffect(() => {
    if (!enabled) {
      const t = setTimeout(() => doneRef.current?.(), HOLD_AFTER)
      return () => clearTimeout(t)
    }

    let line = 0
    let char = 0
    let timer = 0
    let cancelled = false

    const step = () => {
      if (cancelled) return
      const current = lines[line]
      if (!current) { doneRef.current?.(); return }

      if (char >= current.text.length) {
        line += 1
        char = 0
        timer = setTimeout(step, PAUSE_LINE)
        return
      }

      char += 1
      const at = line
      const n = char
      setTyped((prev) => {
        if (prev[at] === n) return prev
        const next = prev.slice()
        next[at] = n
        return next
      })

      // Punctuation gets a beat. Without it the whole paragraph arrives at one
      // unvarying rate, which reads as a machine printing rather than someone
      // speaking.
      const justTyped = current.text[char - 1]
      const pause = /[.:—]/.test(justTyped) ? PAUSE_SENTENCE : 0
      timer = setTimeout(step, CHAR_MS + pause)
    }

    timer = setTimeout(step, 380)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [lines, enabled])

  // Finished typing? Hold, then hand over.
  const total = lines.reduce((acc, l) => acc + l.text.length, 0)
  const shown = counts.reduce((acc, n) => acc + n, 0)
  useEffect(() => {
    if (!enabled || shown < total) return undefined
    const t = setTimeout(() => doneRef.current?.(), HOLD_AFTER)
    return () => clearTimeout(t)
  }, [shown, total, enabled])

  return counts
}

export default function MissionBriefing({ reducedMotion, onDone }) {
  const [shown, setShown] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const lines = useMemo(() => LINES, [])
  const finished = useRef(false)

  useEffect(() => {
    const t = setTimeout(() => setShown(true), 60)
    return () => clearTimeout(t)
  }, [])

  const finish = () => {
    if (finished.current) return
    finished.current = true
    // Fade out first, then hand over — a hard swap here is the blank frame the
    // whole opener exists to avoid.
    setLeaving(true)
    setTimeout(onDone, 420)
  }

  const counts = useTypedLines(lines, { enabled: !reducedMotion, onDone: finish })

  return (
    <div className={`briefing${shown ? ' is-shown' : ''}${leaving ? ' is-leaving' : ''}`}>
      {/* Same plate, same scale, same fade as the completion screen. */}
      <img className="briefing-plate" src={urlFor('iso-background')} alt="" aria-hidden="true" />
      <div className="briefing-sweep" aria-hidden="true" />
      <div className="briefing-scrim" aria-hidden="true" />

      <section className="briefing-panel">
        <p className="briefing-eyebrow">Mission briefing</p>

        {/* The full text is in the DOM for assistive tech from the first frame;
            the typing is presentational only. Reading it out character by
            character would be unusable. */}
        <div className="sr-only">{lines.map((l) => l.text).join(' ')}</div>

        <div className="briefing-body" aria-hidden="true">
          {lines.map((l, i) => (
            l.text === ''
              ? <span key={i} className="briefing-gap" />
              : (
                <p key={i} className={`briefing-line${l.tone ? ` is-${l.tone}` : ''}`}>
                  {l.text.slice(0, counts[i])}
                  {counts[i] > 0 && counts[i] < l.text.length && <i className="briefing-caret" />}
                </p>
              )
          ))}
        </div>

        <button type="button" className="briefing-skip cursor-target" onClick={finish}>
          Begin →
        </button>
      </section>
    </div>
  )
}
