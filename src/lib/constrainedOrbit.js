/**
 * Manual constrained orbit — the input half.
 *
 * Section 5 of the build specification writes this as a controller that moves
 * a THREE camera itself. That shape does not survive contact with this app:
 * the camera is owned by CameraDirector, which eases between stage anchors and
 * re-derives its own pos/tgt every stage change, so a second writer setting
 * camera.position each wheel event would be overwritten mid-ease and would
 * lose the stage framing entirely.
 *
 * So the module keeps what is actually load-bearing — the enable/disable
 * semantics and the sensitivity — and hands the camera work to the director,
 * which already rotates the offset about the target's vertical axis at a fixed
 * radius and a fixed height. That is exactly the constraint section 2.3 asks
 * for; it was simply being driven by a clock instead of by the learner.
 *
 * The accumulator is drained once per frame. Nothing is retained between
 * frames, so movement stops the moment scrolling stops — no inertia, no decay,
 * which is the difference between inspecting an object and being shown one.
 */
export function createOrbitInput({ sensitivity = 0.0018 } = {}) {
  let enabled = false
  let pending = 0

  return {
    get enabled() { return enabled },

    setEnabled(next) {
      enabled = Boolean(next)
      // Anything scrolled on the way out is dropped rather than replayed the
      // next time orbit is switched on.
      if (!enabled) pending = 0
      return enabled
    },

    toggle() { return this.setEnabled(!enabled) },

    onWheel(event) {
      if (!enabled) return
      // Guarded before preventDefault, not after: outside orbit mode the page
      // must scroll normally.
      event.preventDefault()
      pending += event.deltaY * sensitivity
    },

    /** Radians accumulated since the last call. Resets. */
    consume() {
      const d = pending
      pending = 0
      return d
    },
  }
}
