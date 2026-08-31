import { useLayoutEffect, useRef, useState } from 'react'
import { urlFor } from '../lib/assetManifest'
import {
  ISO_SOURCE_SIZE, ISO_LP12_ANCHOR, mapCoverPointToContainer,
} from '../lib/plateAnchor'
/**
 * PAGE 03 — Locate the LP12 Site.
 *
 * The city fills the viewport and stays sharp: this is the one page whose job
 * is reading the environment. It has two things to say — where the dead zone
 * is, and which column fixes it — and it now says both in the same space.
 *
 * THE DEAD ZONE IS ON THE MAP AGAIN, as a red pulsing hemisphere over the
 * pole. It replaces two glass panels that used to carry it: a collapsible
 * summary and a separate diagram in its own viewport. Between them they said
 * in about forty words and a second 3D scene what one red volume over the
 * right piece of street says at a glance — and the diagram's pole was not this
 * pole, so the learner had to map one space onto the other themselves.
 *
 * The old objection to drawing it here was scale: an earlier pass shaded a
 * stretch of carriageway in metres, and the isometric plate carries no
 * surveyed scale, so the polygon claimed a footprint nobody measured. The dome
 * answers that by being sized in plate pixels rather than metres — see
 * DeadZoneDome. It shows roughly this much of this street, which is true,
 * instead of a figure that would not be.
 *
 * The column highlight and its "Click me" leader stay exactly as they were.
 * They no longer wait on an explainer being dismissed, because there is no
 * longer an explainer to dismiss.
 */

// The specification's own replication code hardcodes the target at left 55.8%
// / top 39%. Those are close, but they are measured off one screenshot and
// they drift the moment the viewport changes shape, because the plate is
// object-fit: cover. The projected anchor does not drift, so it stays.

/**
 * Target geometry, in SOURCE-image pixels rather than screen pixels.
 *
 * Expressing it against the 2560-wide plate and scaling by the same factor the
 * anchor uses is what keeps the highlight the same size relative to the pole
 * at every viewport — a fixed pixel size would swallow the pole on a small
 * window and float beside it on a large one.
 *
 * The height and the anchor fraction are measured off our own plate rather
 * than taken from the specification's 72 x 340: those are drawn for a 1920
 * render whose column sits differently, and scaled straight across they stop
 * short of the ground, which leaves the ring hovering. Measured here, the
 * column runs from just above the lamp arm (0.402 of image height) to its base
 * (0.735), with the LP12 anchor at 0.628 — so the highlight is 480 source
 * pixels tall with the anchor 68% of the way down it.
 */
const TARGET = { width: 84, height: 480, ring: 232 }

// Where the anchor sits down the length of the highlight. The LP12 mounts high
// on the column, so the highlight runs mostly above the anchor and stops at
// the ground, which is where the ring goes.
const ANCHOR_DOWN_TARGET = 0.68

function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <path d="M12 1.6v3.2M12 19.2v3.2M1.6 12h3.2M19.2 12h3.2"
            stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export default function Page03LocateSite({ disabled, completed, onSelect }) {
  const layerRef = useRef(null)
  const [box, setBox] = useState(null)

  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer) return undefined
    let raf = 0

    const update = () => {
      const b = layer.getBoundingClientRect()
      // A zero-size box maps every anchor to the origin, which parks the
      // target half off-screen at the top-left with nothing to click. It
      // happens when the effect measures before the layer has been laid out,
      // and the ResizeObserver has no size change to report afterwards
      // because the size was already correct by the time it attached — so the
      // bad value sticks. Retry next frame instead of committing it.
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

  const width = box ? TARGET.width * box.scale : 0
  const height = box ? TARGET.height * box.scale : 0

  return (
    <div ref={layerRef} className="p03-layer">
      <div className="p03-brief">
        <div className="fm-glass p03-capsule">
          <span className="p03-capsule-icon" aria-hidden="true"><TargetIcon /></span>
          <div>
            <strong>Locate the LP12 installation site</strong>
            <span>Select the assigned lighting column.</span>
          </div>
        </div>

      </div>

      {/* Unchanged, and no longer gated on an explainer being dismissed. */}
      {box && (
        <>
          {/* The leader stays decorative; the pill it ends in does not.
              A label that says "Click me" and then ignores the click is worse
              than no label — the words sit 190px left and 74px above the
              column strip that was actually taking the click, so following the
              instruction literally did nothing. It now triggers the same
              selection the column does.

              aria-hidden with tabIndex -1: this is a second pointer affordance
              for an action assistive tech already reaches through the column
              button below, so it is deliberately not a second tab stop or a
              second announcement. */}
          <div
            className="p03-callout"
            style={{ left: box.left, top: box.top - height * ANCHOR_DOWN_TARGET }}
            aria-hidden="true"
          >
            <svg className="p03-callout-line" viewBox="0 0 120 90" preserveAspectRatio="none">
              <path d="M118 88 L60 30 L4 30" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="118" cy="88" r="4" fill="currentColor" />
            </svg>
            <button
              type="button"
              className="fm-glass p03-callout-pill"
              tabIndex={-1}
              disabled={disabled}
              onClick={onSelect}
            >
              Click me
            </button>
          </div>

          <button
            type="button"
            className={`p03-target${completed ? ' is-complete' : ''}`}
            style={{
              left: box.left,
              top: box.top,
              width,
              height,
              // The anchor is the mount point on the column, not the centre of
              // the highlight, so the highlight is hung from it rather than
              // centred on it.
              transform: `translate(-50%, -${ANCHOR_DOWN_TARGET * 100}%)`,
            }}
            disabled={disabled}
            aria-label="Select the LP12 installation pole"
            onClick={onSelect}
          >
            <span className="p03-target-column" aria-hidden="true" />
            <img
              className="p03-target-ring"
              src={urlFor('target-ring')}
              alt=""
              aria-hidden="true"
              style={{ width: TARGET.ring * box.scale }}
            />
          </button>
        </>
      )}
    </div>
  )
}
