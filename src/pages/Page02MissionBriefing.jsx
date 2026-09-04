import { useLayoutEffect, useRef, useState } from 'react'
import ReferenceStage from '../reference/ReferenceStage'
import { ArrowRight, PinIcon } from '../reference/RefIcons'
import {
  ISO_SOURCE_SIZE, ISO_LP12_ANCHOR, mapCoverPointToContainer,
} from '../lib/plateAnchor'
import '../styles/ref-page02.css'

/**
 * FIELD ASSIGNMENT — the briefing and the site, on one screen.
 *
 * This was two pages. The assignment card named the job over the isometric
 * city, Begin dismissed it, and an otherwise identical city came back carrying
 * a "Locate the LP12 installation site" capsule and a "Click me" leader
 * pointing at the column. The learner read the same plate twice and the second
 * pass asked for a click that only confirmed what the first pass had already
 * told them: the replacement goes on the lighting column on the central
 * median. So the two are merged, the capsule and the leader are gone, and
 * Begin now does what the column click used to do — it opens the installation.
 *
 * WHAT SURVIVED, and why each one earns its place on the merged screen:
 *
 *   the dead zone, as the red pulsing dome over the column. It is the reason
 *   there is an assignment at all, and it is the one thing here the card
 *   cannot say in words as well as the plate says it in shape.
 *
 *   the pin, which marks WHICH column. That was the locate page's only real
 *   content and it would be lost with it.
 *
 * THE PIN IS PROJECTED, not placed. It used to sit at the kit's 1040/387
 * inside the reference stage, which is correct only while the plate it points
 * at is also inside that stage. Here the city is App's full-bleed plate — the
 * same one the dome measures itself against — so the pin is mapped through the
 * identical `object-fit: cover` projection the dome uses. Both now hang off
 * ISO_LP12_ANCHOR, so they cannot drift apart from each other or from the pole
 * at any window shape.
 *
 * The stage is `transparent` for the same reason: the card and the wordmark
 * keep their authored reference coordinates, while the city behind them is the
 * live full-bleed plate rather than a copy scaled to the artboard.
 */

export default function Page02MissionBriefing({ reducedMotion, onBegin, busy = false }) {
  const layerRef = useRef(null)
  const [box, setBox] = useState(null)

  /* The same measurement the locate page used for its target. A zero-size box
     maps every anchor to the origin and parks the pin at the top-left corner;
     it happens when the effect runs before layout, and the ResizeObserver has
     no change to report afterwards because the size was already right by the
     time it attached, so the bad value would stick. Retry next frame. */
  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer) return undefined
    let raf = 0

    const update = () => {
      const b = layer.getBoundingClientRect()
      if (!b.width || !b.height) {
        raf = requestAnimationFrame(update)
        return
      }
      setBox(mapCoverPointToContainer(
        { width: b.width, height: b.height }, ISO_SOURCE_SIZE, ISO_LP12_ANCHOR))
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(layer)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  return (
    <>
      {/* Full bleed, over App's plate and under the card: the wash that keeps
          the panel readable, and the pin, both in viewport space so they line
          up with the city rather than with the artboard. */}
      <div className="p02m-wash" aria-hidden="true" />

      <div ref={layerRef} className="p02m-layer" aria-hidden="true">
        {box && (
          <div className="p02r-pin is-projected"
               style={{ left: box.left, top: box.top }}>
            <span className="p02r-pin-dot"><PinIcon size={24} /></span>
            <span className="p02r-pin-label">Awolowo Way</span>
          </div>
        )}
      </div>

      <ReferenceStage className={`p02r${reducedMotion ? ' is-reduced' : ''}`}
                      label="Field assignment" transparent>
        <div className="fm-brand p02r-brand">
          <strong>MIVA</strong><span>OPEN UNIVERSITY</span>
        </div>

        <section className="fm-glass p02r-panel">
          <p className="p02r-eyebrow">Field assignment</p>
          <h1 className="p02r-site">Awolowo Way</h1>
          <p className="p02r-place">Ikeja · Lagos</p>

          <div className="fm-hairline p02r-line" />

          <p className="p02r-brief">Install and commission one<br />LP12 small-cell antenna.</p>
          <p className="p02r-note">
            Replacement goes on the lighting column<br />on the central median.
          </p>

          {/* Begin carries the selection now. It is the only way into the
              installation from this screen, so it is disabled while the
              transition it starts is already running. */}
          <button className="fm-btn fm-btn-primary p02r-begin" type="button"
                  onClick={onBegin} disabled={busy}>
            <span>Begin</span>
            <ArrowRight size={26} />
          </button>
        </section>
      </ReferenceStage>
    </>
  )
}
