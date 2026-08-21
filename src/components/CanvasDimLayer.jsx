/** Cheap navy focus dim, above the canvas and below the UI (brief section 13). */
export default function CanvasDimLayer({ opacity }) {
  return <div aria-hidden="true" className="canvas-dim-layer" style={{ opacity }} />
}
