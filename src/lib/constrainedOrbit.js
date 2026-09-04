/**
 * Manual orbit input — the input half.
 *
 * The camera itself is owned by CameraDirector, which eases between authored
 * stage anchors; a second writer setting camera.position on every event would
 * be overwritten mid-ease. So this module only accumulates intent — azimuth,
 * elevation, dolly and pan — and the director applies it around whatever the
 * stage is currently framing.
 *
 * The gesture set is the one every 3D application uses:
 *
 *   left drag      orbit (horizontal = azimuth, vertical = elevation)
 *   wheel          dolly in/out
 *   right / middle pan the target
 *   double click   back to the authored framing
 *
 * Accumulators are drained once per frame and nothing is retained between
 * frames, so movement stops the moment the input does — no inertia, which is
 * the difference between inspecting an object and being shown one.
 */
export function createOrbitInput({
  sensitivity = 0.005,     // radians per pixel of drag
  zoom = 0.0016,           // log-scale factor per pixel of wheel delta
  pan = 0.0018,            // fraction of orbit radius per pixel of drag
} = {}) {
  let enabled = false
  const acc = { az: 0, el: 0, dolly: 0, panX: 0, panY: 0, reset: false }
  let drag = null           // { mode: 'orbit' | 'pan', x, y, id }

  const clear = () => {
    acc.az = 0; acc.el = 0; acc.dolly = 0; acc.panX = 0; acc.panY = 0
    acc.reset = false
  }

  return {
    get enabled() { return enabled },
    get dragging() { return drag !== null },

    setEnabled(next) {
      enabled = Boolean(next)
      // Anything accumulated on the way out is dropped rather than replayed
      // the next time navigation is switched on.
      if (!enabled) { clear(); drag = null }
      return enabled
    },

    toggle() { return this.setEnabled(!enabled) },

    /** Return to the stage's authored framing. */
    requestReset() { if (enabled) acc.reset = true },

    onWheel(event) {
      if (!enabled) return
      // Guarded before preventDefault, not after: outside navigation mode the
      // page must scroll normally.
      event.preventDefault()
      // deltaMode 1 is lines, 2 is pages — normalise both to pixels, or one
      // Firefox notch dollies as far as thirty Chrome ones.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1
      acc.dolly += event.deltaY * unit * zoom
    },

    onPointerDown(event) {
      if (!enabled) return false
      const mode = event.button === 0 && !event.shiftKey ? 'orbit' : 'pan'
      drag = { mode, x: event.clientX, y: event.clientY, id: event.pointerId }
      return true
    },

    onPointerMove(event) {
      if (!enabled || !drag || event.pointerId !== drag.id) return false
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      drag.x = event.clientX
      drag.y = event.clientY
      if (drag.mode === 'orbit') {
        acc.az -= dx * sensitivity
        acc.el += dy * sensitivity
      } else {
        acc.panX -= dx * pan
        acc.panY += dy * pan
      }
      return true
    },

    onPointerUp(event) {
      if (!drag || (event && event.pointerId !== drag.id)) return false
      drag = null
      return true
    },

    /** Everything accumulated since the last call. Resets. */
    consume() {
      const out = { ...acc }
      clear()
      return out
    },
  }
}
