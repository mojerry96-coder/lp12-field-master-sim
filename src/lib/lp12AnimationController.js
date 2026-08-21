import * as THREE from 'three'

/**
 * Plays one named clip to completion and holds its final pose.
 *
 * Never call .stop() on a completed clip: stopping removes the action's
 * transform contribution and the component springs back to its unassembled
 * rest pose (spec s28).
 */
export function createLP12AnimationController({ actions, mixer }) {
  function prepare(action, timeScale = 1) {
    action.enabled = true
    action.paused = false
    action.reset()
    action.setEffectiveTimeScale(timeScale)
    action.setEffectiveWeight(1)
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    return action
  }

  /**
   * Play one clip to completion.
   *
   * The 'finished' event is the happy path, but it is not guaranteed to
   * arrive: the mixer is advanced by a useFrame subscription, so anything that
   * unmounts the component owning it - a sibling suspending, an HMR swap, a
   * tab throttled in the background - stops the clock mid-clip. The event then
   * never fires and, with no other exit, this promise hangs forever and the
   * caller's stage button stays disabled on "Installing…" for the rest of the
   * session. That is a permanent, unrecoverable lock from a transient cause.
   *
   * So there is a watchdog. If the clip overruns and the mixer clock has
   * genuinely stopped advancing, the clip is snapped to its end pose and the
   * promise resolves: the installation completes correctly and the user can
   * carry on. It warns rather than failing silently, because a stalled clock
   * is a real defect worth seeing in the console even when it is survivable.
   */
  function playOnce(name, { timeScale = 1 } = {}) {
    const action = actions[name]
    if (!action) {
      // s36 / rule: never swallow a missing clip.
      return Promise.reject(new Error(`LP12 animation not found: ${name}`))
    }
    prepare(action, timeScale)
    const clip = action.getClip()
    const expected = clip.duration / Math.max(timeScale, 0.01)

    return new Promise((resolve) => {
      let settled = false
      let watchdog = null

      const settle = (stallReason) => {
        if (settled) return
        settled = true
        mixer.removeEventListener('finished', onFinished)
        if (watchdog !== null) clearInterval(watchdog)
        if (stallReason) {
          console.warn(`[LP12] ${name}: ${stallReason} — snapping to end pose`)
          // Never leave a component half-installed. Same treatment as
          // applyClipEndPose, so the result is identical to a clean run.
          action.time = clip.duration
          action.paused = true
          mixer.update(0)
        }
        resolve()
      }

      const onFinished = (e) => { if (e.action === action) settle(null) }
      mixer.addEventListener('finished', onFinished)
      action.play()

      const startedAt = performance.now()
      let lastMixerTime = mixer.time
      watchdog = setInterval(() => {
        const clockStopped = mixer.time === lastMixerTime
        lastMixerTime = mixer.time
        const elapsed = (performance.now() - startedAt) / 1000
        if (elapsed > expected + 1.0 && clockStopped) {
          settle('mixer clock stopped advancing')
        } else if (elapsed > expected * 3 + 3) {
          settle('clip did not finish in time')
        }
      }, 250)
    })
  }

  /** Snap a clip to its end pose without replaying it (s34). */
  function applyClipEndPose(name) {
    const action = actions[name]
    if (!action) return false
    prepare(action, 1)
    action.play()
    action.time = action.getClip().duration
    mixer.update(0)
    action.paused = true
    return true
  }

  /** Restore the unassembled rest state (s35). */
  function resetAll() {
    Object.values(actions).forEach((a) => {
      if (!a) return
      a.stop()
      a.reset()
      a.enabled = false
      a.setEffectiveWeight(0)
    })
    mixer.update(0)
  }

  return { playOnce, applyClipEndPose, resetAll, mixer }
}
