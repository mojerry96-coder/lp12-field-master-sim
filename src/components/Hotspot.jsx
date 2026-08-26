import { useLayoutEffect, useRef, useState } from 'react'

const SOURCE_SIZE = { width: 2560, height: 1440 }
// Not eyeballed. These are LP12_INSTALL_ANCHOR projected through
// CAM_ENV_ISOMETRIC with bpy_extras.world_to_camera_view at render time, so
// the marker sits on the actual pole rather than near it. Re-render the
// isometric and the projection has to be recomputed with it.
const LP12_IMAGE_ANCHOR = { x: 0.5447, y: 0.6281 }

/**
 * object-fit: cover crops the image, so a plain percentage drifts as the
 * viewport shape changes. Recompute the rendered image rectangle instead.
 */
export function mapCoverPointToContainer(container, image, point) {
  const scale = Math.max(container.width / image.width, container.height / image.height)
  const renderedWidth = image.width * scale
  const renderedHeight = image.height * scale
  const offsetX = (container.width - renderedWidth) / 2
  const offsetY = (container.height - renderedHeight) / 2
  return { left: offsetX + point.x * renderedWidth, top: offsetY + point.y * renderedHeight }
}

export default function ResponsiveLP12Hotspot({ disabled, completed, onActivate }) {
  const layerRef = useRef(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })

  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    let raf = 0
    const update = () => {
      const b = layer.getBoundingClientRect()
      // A zero-size box maps every anchor to the origin, which parks the
      // hotspot half off-screen at the top-left with nothing to click. It
      // happens when the effect measures before the layer has been laid out,
      // and the ResizeObserver has no size change to report afterwards
      // because the size was already correct by the time it attached — so
      // the bad value sticks. Retry next frame instead of committing it.
      if (!b.width || !b.height) {
        raf = requestAnimationFrame(update)
        return
      }
      setPosition(mapCoverPointToContainer(
        { width: b.width, height: b.height }, SOURCE_SIZE, LP12_IMAGE_ANCHOR))
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
    <div ref={layerRef} className="hotspot-layer">
      <button type="button"
        className={`lp12-image-hotspot cursor-target ${completed ? 'is-complete' : ''}`}
        style={{ left: position.left, top: position.top }}
        disabled={disabled}
        aria-label="Open the LP12 installation model"
        onClick={onActivate}>
        <span className="lp12-image-hotspot__ring" aria-hidden="true" />
        <span className="lp12-image-hotspot__label">
          {completed ? 'LP12 ✓' : 'Click me'}
        </span>
      </button>
    </div>
  )
}
