import { useEffect, useState } from 'react'
import { HAND_ANCHORS, TABLET_ARTBOARD } from './tuning-config'

/**
 * Tutorial hand overlay — point, then tap.
 *
 * This is a demonstration layer, not a cursor. It appears only when the
 * simulation is showing the learner a control, and it never intercepts input:
 * the whole layer is pointer-events: none, so the real button underneath stays
 * clickable throughout.
 *
 * Both plates are full 1672×941 artboard images with the hand already in
 * position, so aligning them means translating the whole plate until the
 * fingertip anchor lands on the target — not moving a cropped sprite. That is
 * what keeps the forearm running off the edge of the scene instead of ending
 * in mid-air inside the frame.
 */
export default function GuidedHandOverlay({ cue, reducedMotion = false }) {
  const [phase, setPhase] = useState('hidden')
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!cue) { setPhase('hidden'); return undefined }

    const artboard = document.querySelector('.lp12-artboard')?.getBoundingClientRect()
    const target = document.getElementById(cue.targetId)?.getBoundingClientRect()
    if (!artboard || !target) return undefined

    // Convert the target's browser rectangle back into artboard coordinates;
    // the artboard is uniformly scaled, so one factor per axis is enough.
    const scaleX = TABLET_ARTBOARD.width / artboard.width
    const scaleY = TABLET_ARTBOARD.height / artboard.height
    const targetX = (target.left + target.width / 2 - artboard.left) * scaleX
    const targetY = (target.top + target.height / 2 - artboard.top) * scaleY

    const p = HAND_ANCHORS.point
    setOffset({ x: targetX - p.x, y: targetY - p.y - 18 })
    setPhase('point')

    if (cue.sequence !== 'tap') return undefined

    // Reduced motion: hold the static point cue, never animate to a tap.
    if (reducedMotion) return undefined

    const tapTimer = window.setTimeout(() => {
      const t = HAND_ANCHORS.tap
      setOffset({ x: targetX - t.x, y: targetY - t.y })
      setPhase('tap')
    }, 520)
    const hideTimer = window.setTimeout(() => setPhase('hidden'), 700)
    return () => { clearTimeout(tapTimer); clearTimeout(hideTimer) }
  }, [cue, reducedMotion])

  if (phase === 'hidden') return null

  return (
    <img
      className={`lp12-guided-hand is-${phase}`}
      src={phase === 'tap'
        ? '/assets/lp12/hand-tap-alpha.png'
        : '/assets/lp12/hand-point-alpha.png'}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
    />
  )
}
