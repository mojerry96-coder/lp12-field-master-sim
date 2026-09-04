import { useEffect, useState } from 'react'
import '../styles/reference.css'

/**
 * The replication kit's fixed 1672 x 941 stage, scaled uniformly to the window.
 *
 * Every position on the six replicated screens is authored in the reference
 * render's own pixels and the whole stage is then scaled by one factor, so the
 * composition cannot drift: panels keep their coordinates, rules keep their
 * lengths, type keeps its measure and nothing rewraps between one viewport and
 * the next. That is the kit's explicit instruction for the first pass, and it
 * is the only way a pixel comparison against the supplied PNGs means anything.
 *
 * WHAT THIS COSTS, since it is a real trade. A uniformly scaled stage
 * letterboxes: on a window whose aspect is not 16:9 there are bands of flat
 * colour top-and-bottom or left-and-right, and text scales rather than reflows,
 * so on a small window everything is small together. Our other pages — the
 * assembly stages, the rig pages, the tuning tablet — stay responsive and are
 * deliberately NOT wrapped in this. The kit says responsive variants come after
 * the design is approved, so this is the first pass, not the final answer.
 *
 * `transparent` drops the stage's own ground so the layer can be laid over a
 * live 3D scene: the corridor debrief is authored in reference pixels but the
 * thing behind it is the running test, not a plate.
 *
 * `fmref` is a namespace, and it matters. The kit redefines --fm-blue,
 * --fm-glass-fill, --fm-radius-lg and the .fm-glass / .fm-btn / .fm-chip
 * classes with different values from the ones the rest of this app already
 * uses. Loading that globally would restyle every existing page. Scoping it to
 * this class means the kit's system applies inside these six screens and
 * nowhere else.
 */

export const STAGE_W = 1672
export const STAGE_H = 941

export default function ReferenceStage({
  children, className = '', label, transparent = false, plate = null,
}) {
  const [scale, setScale] = useState(null)

  useEffect(() => {
    const fit = () => setScale(Math.min(
      window.innerWidth / STAGE_W,
      window.innerHeight / STAGE_H,
    ))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  return (
    <section className={`fmref fmref-viewport${transparent ? ' is-transparent' : ''}`}
             aria-label={label}>
      {/* The letterbox fill.
          A uniformly scaled stage cannot fill a window whose aspect is not the
          artboard's: at 1440x900 the stage lands at 1440x810 and leaves 45px of
          flat page colour above and below it, so a page whose background IS a
          photograph visibly stopped short of the top and bottom edges. This is
          the same plate, cover-fitted to the whole viewport and thrown out of
          focus, so the bands read as the image continuing rather than as two
          strips of UI chrome. The stage keeps its exact authored crop on top —
          which is why this is a second copy rather than simply cover-fitting
          the real one, whose composition the UI is aligned to. */}
      {plate && !transparent && (
        <img className="fmref-bleed" src={plate} alt="" aria-hidden="true"
             draggable={false} decoding="async" />
      )}

      <div
        className={`fmref-stage ${className}`}
        /* Hidden until measured: at scale 1 the stage is 1672px wide on a
           narrower window, so a first paint before the effect runs shows the
           composition cropped and then snapping. */
        style={scale === null
          ? { visibility: 'hidden' }
          : { transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {children}
      </div>
    </section>
  )
}
