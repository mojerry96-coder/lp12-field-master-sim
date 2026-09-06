/**
 * The one sound in the simulation: a gear click, on the tuning controls.
 *
 * The source recording (koiroylers-gear-click-351962) is not a click — it is a
 * two-second ratchet RUN, twenty-eight clicks about 72ms apart. So the asset is
 * ONE click cut out of that run: the clean one at 0.641s, which has 73ms of
 * silence in front of it and 79ms behind. See preserved/sfx-source/ for the
 * derivation.
 *
 * It plays on a detent — a slider or dial moving by one step — and nowhere
 * else. There was a second use: a run of these clicks scheduled across an
 * assembly clip's exact duration, so a part being fitted sounded like it was
 * being wound into place. It measured well and it did not sound right, which is
 * the one thing measurement cannot tell you. It is in the history if a future
 * install sound wants the scheduling; nothing here needs it now.
 */

const SRC = '/sfx/gear-click.wav'

/**
 * Level.
 *
 * The asset peaks at -1 dBFS so it can be attenuated cleanly rather than
 * amplified. 0.34 through the master puts a single click at about -11 dBFS
 * peak, measured by rendering it offline: audible over a room, well short of
 * startling, and with headroom left.
 */
const LEVEL = { master: 0.9, detent: 0.34 }

/**
 * A detent faster than this is a drag, not a step.
 *
 * Measurement interval is 160 steps wide, so sweeping it end to end asks for a
 * click every few milliseconds and gets a buzz. Dropping the ones that fall
 * inside the mechanism's own spacing turns the same gesture into a ratchet,
 * while a deliberate single step still clicks exactly once.
 */
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
 * decoded buffer, and the click has to land on the step that caused it.
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

/** Nudges pitch a few percent either way, so a sequence of steps does not read
 *  as one file played over: real ratchet teeth do not all sound alike. */
const wobble = (spread) => 1 + (Math.random() * 2 - 1) * spread

function ready() {
  if (!ensureContext()) return false
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  if (!buffer) { load(); return false }
  return true
}

/** One click, for one step of a slider or dial. */
export function detent({ gain = LEVEL.detent, spread = 0.05 } = {}) {
  if (!ready()) return
  const now = ctx.currentTime
  if (now - lastDetentAt < DETENT_MIN_GAP) return
  lastDetentAt = now

  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.playbackRate.value = wobble(spread)
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(g).connect(master)
  src.start(now)
}

/** Debug handle, alongside the store's own. */
if (typeof globalThis !== 'undefined') {
  globalThis.__lp12sfx = {
    detent,
    load,
    setVolume: (v) => { if (ensureContext()) master.gain.value = Math.max(0, Math.min(1, v)) },
    levels: LEVEL,
  }
}
