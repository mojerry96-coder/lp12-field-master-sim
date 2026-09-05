import '../styles/reference.css'

/**
 * The shell the replicated screens are laid out inside.
 *
 * IT NO LONGER SCALES. It used to hold a fixed 1672 x 941 artboard and shrink
 * the whole thing with one transform, which is how the kit's first pass was
 * specified and the only way a pixel comparison against the supplied PNGs
 * meant anything. The cost was the thing that eventually had to be paid: the
 * artboard is 16:9 and almost no window is, so the stage was width-bound at
 * every size we measured and simply threw the spare height away — 162px of
 * empty band top and bottom at 1200x1000 — while every piece of type shrank
 * with the window rather than reflowing. Authored 14px copy rendered at 8.6px
 * on a 1024-wide screen. The page was a picture being resized, not a layout.
 *
 * So the artboard is design intent now, not geometry. Each screen lays itself
 * out in its own CSS with real units — percentages, clamp(), grid, flex — and
 * the coordinates in those files are the reference's proportions rather than
 * its pixels. What was one shared scaling trick is now six responsive layouts,
 * which is the work the kit's own note deferred: "responsive variants come
 * after the design is approved".
 *
 * With nothing letterboxed there is nothing to fill, so the bleed layer that
 * used to cover the bands is gone with it; a plate now simply covers its own
 * screen.
 *
 * `transparent` still drops the shell's ground so the layer can sit over a
 * live 3D scene — the corridor debrief and the pole overview are both drawn
 * over something running underneath.
 *
 * `fmref` is a namespace and it still matters. The kit redefines --fm-blue,
 * --fm-glass-fill, --fm-radius-lg and the .fm-glass / .fm-btn / .fm-chip
 * classes with different values from the ones the rest of this app uses.
 * Loading that globally would restyle every existing page.
 */

export default function ReferenceStage({
  children, className = '', label, transparent = false,
}) {
  return (
    <section className={`fmref fmref-viewport${transparent ? ' is-transparent' : ''}`}
             aria-label={label}>
      <div className={`fmref-stage ${className}`}>{children}</div>
    </section>
  )
}
