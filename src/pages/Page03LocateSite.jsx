import { useLayoutEffect, useRef, useState } from 'react'
import DeadZoneViewport from '../components/DeadZoneViewport'
import { urlFor } from '../lib/assetManifest'
import {
  ISO_SOURCE_SIZE, ISO_LP12_ANCHOR, mapCoverPointToContainer,
} from '../lib/plateAnchor'
/**
 * PAGE 03 — Locate the LP12 Site.
 *
 * The city fills the viewport and stays sharp: this is the one page whose job
 * is reading the environment. The map has exactly two of them — understand the
 * location, and identify the right column — so the dead zone is NOT drawn on
 * it. An earlier pass shaded a stretch of the carriageway, and it could only
 * ever be an approximation: the isometric plate carries no surveyed scale, so
 * a polygon over it claims a footprint nobody measured.
 *
 * The dead zone gets its own explainer instead — a real 3D diagram in the
 * lower-left panel, with its own camera and its own coordinate system, where a
 * red hemisphere over a pole means exactly what it looks like. The two spaces
 * stay separate, which is what stops either of them lying.
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
  /* Open on arrival. The learner is being told what is wrong with this street
     before being asked to fix it, and the explainer is that telling; closing it
     is the acknowledgement, which is why the column only becomes selectable
     afterwards. */
  const [explainerOpen, setExplainerOpen] = useState(true)

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

        {/* Summary and trigger in one control. It states the problem in the
            three lines the brief specifies and toggles the diagram that
            explains it. */}
        <button
          type="button"
          className="fm-glass p03-deadzone"
          aria-expanded={explainerOpen}
          onClick={() => setExplainerOpen((open) => !open)}
        >
          <span className="p03-dz-swatch" aria-hidden="true" />
          <span className="p03-dz-head">
            <strong>Network dead zone</strong>
            <span>LP12 requires line-of-sight to the network.</span>
            <span>Structures and distance can block the signal,</span>
            <span>creating a dead zone.</span>
          </span>
          <svg className={`p03-dz-chevron${explainerOpen ? ' is-open' : ''}`}
               viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
                  strokeLinejoin="round" d="m7 10 5 5 5-5" />
          </svg>
        </button>
      </div>

      {/* The diagram, and the whole of what the map is not asked to carry. */}
      {explainerOpen && (
        <aside className="fm-glass p03-explainer"
               aria-label="Understanding the network dead zone">
          <header className="p03-explainer-head">
            <h2>Understanding the network dead zone</h2>
            <button type="button" className="p03-explainer-close"
                    onClick={() => setExplainerOpen(false)}
                    aria-label="Close network dead zone explanation">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M6 6 18 18M18 6 6 18" fill="none" stroke="currentColor"
                      strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="p03-explainer-stage">
            <DeadZoneViewport />
            <div className="p03-no-service" aria-hidden="true">
              <span>×</span> No service
            </div>
          </div>

          <footer className="p03-explainer-foot">
            <p className="p03-explainer-legend">
              <span aria-hidden="true" /> <strong>Dead zone</strong>
            </p>
            <p>
              Obstructions and distance prevent a reliable network connection.
              <br />
              Install LP12 at a location with clear line-of-sight.
            </p>
          </footer>
        </aside>
      )}

      {/* The column becomes findable once the explainer has been read and
          dismissed. Both of them competing for the same attention is what the
          brief separates. */}
      {box && !explainerOpen && (
        <>
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
            <span className="fm-glass p03-callout-pill">Click me</span>
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
