import { useLayoutEffect, useRef, useState } from 'react'

const SOURCE_SIZE = { width: 1672, height: 941 }
// Verified against the supplied image: this lands on the roadside pole by the
// Bank of Industry. Nudged from the brief's 0.696 after visual check.
const LP12_IMAGE_ANCHOR = { x: 0.698, y: 0.64 }

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
    const update = () => {
      const b = layer.getBoundingClientRect()
      setPosition(mapCoverPointToContainer(
        { width: b.width, height: b.height }, SOURCE_SIZE, LP12_IMAGE_ANCHOR))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(layer)
    return () => observer.disconnect()
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
          {completed ? 'LP12 ✓' : 'LP12'}
        </span>
      </button>
    </div>
  )
}
