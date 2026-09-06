/**
 * The one sound in the simulation: a gear click.
 *
 * The source recording (koiroylers-gear-click-351962) is not a click — it is a
 * two-second ratchet RUN, twenty-eight clicks about 72ms apart. Playing the
 * file whole on every event would give a two-second burst regardless of what
 * the event was, which is precisely the mismatch to avoid: an install clip is
 * whatever length the GLB says it is, and a slider detent is instantaneous.
 *
 * So the asset is ONE click cut out of that run — the clean one at 0.641s,
 * which has 73ms of silence in front of it and 79ms behind — and the runs are
 * rebuilt here by scheduling it. A scheduled run can be any length, so it can
 * be the length of the thing it is describing. That is the whole design.
 *
 * Scheduling is done against the AudioContext clock rather than setTimeout.
 * Timers on the main thread drift by tens of milliseconds under the load of a
 * three.js scene mid-animation, which at 72ms spacing is audible as a stumble;
 * `start(when)` is sample-accurate and immune to whatever the renderer is
 * doing.
 */

const SRC = '/sfx/gear-click.wav'

/**
 * The transient peaks 3.5ms into the file, so a click scheduled at T is HEARD
 * at T+3.5ms. Every scheduling point below subtracts this, which is the difference
 * between a run that sits on the beat and one that lags it consistently.
 */
const ATTACK_LEAD = 0.0035

/* The source's own cadence, and therefore the cadence this reads as correct
   at: 72ms between clicks, ~14 a second. */
const CLICK_SPACING = 0.072

/**
 * Levels.
 *
 * The asset peaks at -1 dBFS so it can be attenuated cleanly rather than
 * amplified. A RUN is perceptually much louder than a single click at the same
 * gain — twenty-odd transients a second read as one continuous sound — so the
 * ratchet is set lower per click than the detent, and the two end up sounding
 * like the same mechanism at the same distance rather than one being a shout.
 */
const LEVEL = {
  master: 0.9,
  ratchet: 0.22,   // -14 dBFS peak per click, in a dense run
  detent: 0.34,    // -10 dBFS peak, one at a time
  seat: 0.42,      // the single firmer click that ends an install
}

/** A detent faster than this is a drag, not a step: clicks get thinned to the
 *  ratchet's own spacing so a fast slider sweep sounds like the mechanism and
 *  not like a buzzer. */
const DETENT_MIN_GAP = 0.055

let ctx = null
let master = null
let buffer = null
let loading = null
let unlocked = false
let lastDetentAt = -1

const supported = () => typeof window !== 'undefined'
  && (window.AudioContext || window.webkitAudioContext)

function ensureContext() {
  if (ctx || !supported()) return ctx
  const AC = window.AudioContext || window.webkitAudioContext
  ctx = new AC()
  master = ctx.createGain()
  master.gain.value = LEVEL.master
  master.connect(ctx.destination)
  return ctx
}

/**
 * Decode once, reuse forever. 5.5KB of PCM, so this is a single small fetch
 * with no format ambiguity — WAV rather than MP3 deliberately, because MP3
 * encoder delay puts a variable few milliseconds of silence in front of the
 * decoded buffer and this file exists to be precisely on time.
 */
function load() {
  if (buffer) return Promise.resolve(buffer)
  if (loading) return loading
  if (!ensureContext()) return Promise.resolve(null)
  loading = fetch(SRC)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
    .then((raw) => new Promise((res, rej) => ctx.decodeAudioData(raw, res, rej)))
    .then((buf) => { buffer = buf; return buf })
    .catch((err) => {
      // Sound is not load-bearing. A missing or undecodable asset costs the
      // learner nothing, so it must never surface as a broken interaction.
      console.warn('[LP12] gear click unavailable:', err?.message || err)
      return null
    })
  return loading
}

/**
 * Browsers refuse to start an AudioContext outside a user gesture, and a
 * context created in a refused state stays suspended until something resumes
 * it. Every trigger in this app follows a tap, but the FIRST one can land close
 * enough to the gesture's edge to be rejected, so the unlock is hung off the
 * document instead and the audio path is warm before anything asks it to play.
 */
export function unlockAudio() {
  if (unlocked || !supported()) return
  const go = () => {
    unlocked = true
    const c = ensureContext()
    if (c && c.state === 'suspended') c.resume().catch(() => {})
    load()
    document.removeEventListener('pointerdown', go)
    document.removeEventListener('keydown', go)
  }
  document.addEventListener('pointerdown', go, { once: true, passive: true })
  document.addEventListener('keydown', go, { once: true })
}

function voice(at, gain, rate) {
  if (!buffer || !ctx) return
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.playbackRate.value = rate
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(g).connect(master)
  src.start(Math.max(ctx.currentTime, at - ATTACK_LEAD))
}

/** Nudges pitch a few percent either way. A run of identical samples reads as
 *  a loop of one file; real ratchet teeth do not all sound the same. */
const wobble = (spread) => 1 + (Math.random() * 2 - 1) * spread

function ready() {
  if (!ensureContext()) return false
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  if (!buffer) { load(); return false }
  return true
}

/**
 * One click, for a discrete step: a slider detent, a dial notch.
 *
 * Thinned rather than queued. Dragging the interval slider end to end crosses
 * 160 steps in under a second; a click per step is a buzz, and dropping the
 * ones that fall inside the mechanism's own spacing turns the same gesture
 * into the ratchet it should have been.
 */
export function detent({ gain = LEVEL.detent, spread = 0.05 } = {}) {
  if (!ready()) return
  const now = ctx.currentTime
  if (now - lastDetentAt < DETENT_MIN_GAP) return
  lastDetentAt = now
  voice(now + ATTACK_LEAD, gain, wobble(spread))
}

/**
 * A run of clicks lasting exactly `seconds` — the part being wound into place.
 *
 * Timed off the animation clip's own duration, so the sound stops when the
 * hardware does. The spacing eases outward across the run rather than staying
 * flat: a fastener goes in freely and slows as it tightens, and an even
 * metronome across two seconds is the one thing that would sound synthetic.
 *
 * `stop()` is essential rather than tidy. Every click of the run is already
 * scheduled on the audio clock, so a clip that is cut short — an unmount, the
 * controller's stall watchdog, a learner going Back — would otherwise be
 * followed by a ratchet still running in an empty room.
 */
export function ratchet(seconds, { gain = LEVEL.ratchet, seat = true } = {}) {
  /**
   * Cancels only what has not been heard yet.
   *
   * The caller stops the run in a `finally`, which on a clean clip fires the
   * instant the mixer reports 'finished' — the same moment the seating click
   * is scheduled for. Stopping every voice indiscriminately is therefore a race
   * against the last and most deliberate sound in the run, and one it would
   * sometimes lose. Voices whose time has passed are left alone; only the
   * genuinely unplayed remainder of an interrupted clip is cut.
   */
  const stop = () => {
    const now = ctx ? ctx.currentTime : Infinity
    voices.forEach(({ src, at }) => {
      if (at <= now) return
      try { src.stop() } catch { /* already ended */ }
    })
    voices.length = 0
  }
  const voices = []
  if (!ready() || !(seconds > 0)) return { stop }

  const t0 = ctx.currentTime
  // Enough clicks to hold the source's cadence, and at least a couple so a
  // very short clip still reads as a mechanism rather than a blip.
  const n = Math.max(2, Math.round(seconds / CLICK_SPACING))

  /**
   * The run is built from its GAPS, not from a curve through its positions.
   *
   * Placing clicks at `seconds * u ** p` is the obvious way and it cannot say
   * the thing that actually matters here, which is how close together two
   * clicks may get. Any exponent above 1 collapses the first interval toward
   * zero — measured, that curve opened with 25ms between clicks where the
   * source recording never goes below 55 — and the only way to widen it is to
   * flatten the whole run until it is a metronome.
   *
   * Ramping the gap linearly from SPREAD_MIN to SPREAD_MAX and scaling the
   * ramp to fit `seconds` states the constraint directly: the run still slows
   * as the part beds in, and no two clicks are ever closer than a real ratchet
   * puts them.
   */
  const SPREAD = 1.7                       // last gap / first gap
  const mean = seconds / (n - 1 || 1)
  const first = (2 * mean) / (1 + SPREAD)
  const step = n > 2 ? ((SPREAD - 1) * first) / (n - 2) : 0

  let at = t0
  for (let i = 0; i < n; i += 1) {
    // The last click is the part seating home — firmer and a little lower, so
    // the run resolves rather than stopping. It IS the final click rather than
    // an extra one after it: scheduled separately, it landed on the same
    // millisecond as the run's own last click and the two read as one flam.
    const last = i === n - 1
    // Fades in over the first two clicks and backs off over the last three, so
    // the run arrives and leaves rather than being switched on and off.
    const edge = Math.min(1, (i + 1) / 2, (n - i) / 3)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = last && seat ? 0.86 : wobble(0.06)
    const g = ctx.createGain()
    g.gain.value = last && seat ? LEVEL.seat : gain * (0.72 + 0.28 * edge)
    src.connect(g).connect(master)
    const when = Math.max(ctx.currentTime, at - ATTACK_LEAD)
    src.start(when)
    voices.push({ src, at: when })

    const gap = first + step * i
    // Jitter proportional to the gap, so it can never eat a short one. A fixed
    // millisecond wobble is what turned a 39ms interval into a 26ms one.
    at += gap * (1 + (Math.random() * 2 - 1) * 0.06)
  }

  return { stop }
}

/** Debug handle, alongside the store's own. */
if (typeof globalThis !== 'undefined') {
  globalThis.__lp12sfx = {
    detent,
    ratchet,
    load,
    setVolume: (v) => { if (ensureContext()) master.gain.value = Math.max(0, Math.min(1, v)) },
    levels: LEVEL,
  }
}
