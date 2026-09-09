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

/* ------------------------------------------------------------------ *
 * Installation interaction cues.
 *
 * Three one-shots for the physical part of the exercise: picking a
 * component up, seating the right one, and being refused the wrong one.
 * They share the context and the master above and hang off their own
 * group gain so the whole installation layer can be trimmed in one
 * place. One-shot only: no loop, no pitch shift, no effects.
 * ------------------------------------------------------------------ */

const INSTALL_MASTER = 0.8

const INSTALL_SFX = {
  pickup: { src: '/sfx/spawn-pop.mp3', volume: 0.46 },
  correct: { src: '/sfx/place-correct.mp3', volume: 0.52 },
  incorrect: { src: '/sfx/place-incorrect.mp3', volume: 0.38 },
}

const PICKUP_COOLDOWN_MS = 120

let installGain = null
const installBuffers = new Map()   // key -> AudioBuffer
const installLoading = new Map()   // key -> promise
const installVoices = new Map()    // key -> live AudioBufferSourceNode
let lastPickupAt = -Infinity

function ensureInstallGroup() {
  if (!ensureContext()) return null
  if (!installGain) {
    installGain = ctx.createGain()
    installGain.gain.value = INSTALL_MASTER
    installGain.connect(master)
  }
  return installGain
}

function loadInstall(key) {
  if (installBuffers.has(key)) return Promise.resolve(installBuffers.get(key))
  if (installLoading.has(key)) return installLoading.get(key)
  if (!ensureContext()) return Promise.resolve(null)
  const p = fetch(INSTALL_SFX[key].src)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
    .then((raw) => new Promise((res, rej) => ctx.decodeAudioData(raw, res, rej)))
    .then((buf) => { installBuffers.set(key, buf); return buf })
    .catch((err) => {
      // Sound is never load-bearing: a missing cue must not break a drop.
      console.warn(`[LP12] ${key} cue unavailable:`, err?.message || err)
      return null
    })
    .finally(() => { installLoading.delete(key) })
  installLoading.set(key, p)
  return p
}

/** Decode all three before the learner's first drop. */
export function preloadInstallSfx() {
  if (!supported()) return Promise.resolve()
  return Promise.all(Object.keys(INSTALL_SFX).map(loadInstall)).then(() => {})
}

function playInstall(key) {
  const group = ensureInstallGroup()
  if (!group) return
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  const buffer = installBuffers.get(key)
  if (!buffer) { loadInstall(key); return }

  // One instance per cue, and the two placement cues are mutually exclusive:
  // a rapid second drop restarts the relevant cue rather than layering.
  const stop = (k) => {
    const live = installVoices.get(k)
    if (live) { try { live.stop() } catch { /* already ended */ } installVoices.delete(k) }
  }
  stop(key)
  if (key === 'correct' || key === 'incorrect') {
    stop(key === 'correct' ? 'incorrect' : 'correct')
  }

  const src = ctx.createBufferSource()
  src.buffer = buffer
  const g = ctx.createGain()
  g.gain.value = INSTALL_SFX[key].volume
  src.connect(g).connect(group)
  src.onended = () => { if (installVoices.get(key) === src) installVoices.delete(key) }
  installVoices.set(key, src)
  src.start(ctx.currentTime)
}

/** A part is picked up — the drag has genuinely begun. */
export function pickup() {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  // pointerdown, touchstart and dragstart can all describe the same pickup.
  if (now - lastPickupAt < PICKUP_COOLDOWN_MS) return
  lastPickupAt = now
  playInstall('pickup')
}

/** The correct component seats. Muted for now — keep the wiring intact. */
export function placeCorrect() { return }

/** A component is refused. */
export function placeIncorrect() { playInstall('incorrect') }

/* ------------------------------------------------------------------ *
 * Tablet network tuning.
 *
 * A radio-tuning bed the learner searches with, and a confirmation
 * one-shot when the value lands. One voice for all three sliders: the
 * bed is a single looping buffer whose gain and lowpass corner follow
 * proximity continuously, so approaching the answer sounds clearer
 * rather than merely louder, and nothing on the screen says so.
 *
 * Both hang off the shared context and master, so the global level
 * stays single-sourced.
 * ------------------------------------------------------------------ */

const TUNING_MASTER = 1

const TUNING_SFX = {
  search: { src: '/sfx/tuning-search.mp3' },
  correct: { src: '/sfx/tuning-correct.mp3', volume: 0.48 },
}

const TUNING_AUDIO = {
  searchMin: 0.20,
  searchMax: 0.36,
  filterMin: 2200,
  filterMax: 8000,
  fadeIn: 0.08,
  fadeOut: 0.13,
  fadeLock: 0.08,
}

let tuningGroup = null
const tuningBuffers = new Map()
const tuningLoading = new Map()

/** The single live bed: { src, filter, gain } or null. */
let searchVoice = null
let searchStopTimer = null

const lerp = (a, b, t) => a + (b - a) * t

function ensureTuningGroup() {
  if (!ensureContext()) return null
  if (!tuningGroup) {
    tuningGroup = ctx.createGain()
    tuningGroup.gain.value = TUNING_MASTER
    tuningGroup.connect(master)
  }
  return tuningGroup
}

function loadTuning(key) {
  if (tuningBuffers.has(key)) return Promise.resolve(tuningBuffers.get(key))
  if (tuningLoading.has(key)) return tuningLoading.get(key)
  if (!ensureContext()) return Promise.resolve(null)
  const p = fetch(TUNING_SFX[key].src)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
    .then((raw) => new Promise((res, rej) => ctx.decodeAudioData(raw, res, rej)))
    .then((buf) => { tuningBuffers.set(key, buf); return buf })
    .catch((err) => {
      console.warn(`[LP12] tuning ${key} cue unavailable:`, err?.message || err)
      return null
    })
    .finally(() => { tuningLoading.delete(key) })
  tuningLoading.set(key, p)
  return p
}

/** Decode both before the learner touches the first slider. */
export function preloadTuningSfx() {
  if (!supported()) return Promise.resolve()
  return Promise.all(Object.keys(TUNING_SFX).map(loadTuning)).then(() => {})
}

function clearStopTimer() {
  if (searchStopTimer !== null) { clearTimeout(searchStopTimer); searchStopTimer = null }
}

/**
 * Begin — or keep — the one search bed. The buffer is never restarted by a
 * value change; only the first start creates a voice, and a start arriving
 * during a fade-out cancels the fade rather than layering a second loop.
 */
export function startTuningSearch(proximity = 0) {
  const group = ensureTuningGroup()
  if (!group) return
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  const buffer = tuningBuffers.get('search')
  if (!buffer) { loadTuning('search').then((b) => { if (b) startTuningSearch(proximity) }); return }

  clearStopTimer()

  if (!searchVoice) {
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = lerp(TUNING_AUDIO.filterMin, TUNING_AUDIO.filterMax, proximity)
    filter.Q.value = 0.7
    const gain = ctx.createGain()
    gain.gain.value = 0
    src.connect(filter).connect(gain).connect(group)
    src.start(ctx.currentTime)
    searchVoice = { src, filter, gain }
  }

  const now = ctx.currentTime
  const target = lerp(TUNING_AUDIO.searchMin, TUNING_AUDIO.searchMax, proximity)
  const g = searchVoice.gain.gain
  g.cancelScheduledValues(now)
  g.setValueAtTime(g.value, now)
  g.linearRampToValueAtTime(target, now + TUNING_AUDIO.fadeIn)
}

/**
 * Follow the value. Smoothed rather than set, so a drag does not zip.
 * `attenuate` is the idle rule's trim while the learner holds still.
 */
export function updateTuningSearch(proximity, attenuate = 1) {
  if (!searchVoice || !ctx) return
  const now = ctx.currentTime
  const volume = lerp(TUNING_AUDIO.searchMin, TUNING_AUDIO.searchMax, proximity) * attenuate
  const freq = lerp(TUNING_AUDIO.filterMin, TUNING_AUDIO.filterMax, proximity)
  searchVoice.gain.gain.cancelScheduledValues(now)
  searchVoice.gain.gain.setTargetAtTime(volume, now, 0.035)
  searchVoice.filter.frequency.setTargetAtTime(freq, now, 0.045)
}

/** Fade the bed away and release the voice. Safe to call when nothing plays. */
export function stopTuningSearch(seconds = TUNING_AUDIO.fadeOut) {
  if (!searchVoice || !ctx) return
  const voice = searchVoice
  searchVoice = null
  clearStopTimer()
  const now = ctx.currentTime
  const g = voice.gain.gain
  g.cancelScheduledValues(now)
  g.setValueAtTime(g.value, now)
  g.linearRampToValueAtTime(0, now + seconds)
  searchStopTimer = setTimeout(() => {
    searchStopTimer = null
    try { voice.src.stop() } catch { /* already ended */ }
    try { voice.src.disconnect() } catch { /* already detached */ }
  }, seconds * 1000 + 40)
}

/** The value has landed. Fades the bed quickly, then confirms once. */
export function tuningCorrect() {
  const group = ensureTuningGroup()
  stopTuningSearch(TUNING_AUDIO.fadeLock)
  if (!group) return
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  const buffer = tuningBuffers.get('correct')
  if (!buffer) { loadTuning('correct'); return }
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const g = ctx.createGain()
  g.gain.value = TUNING_SFX.correct.volume
  src.connect(g).connect(group)
  // Starts as the bed's 80ms fade is ending: confirmation, not a chord.
  src.start(ctx.currentTime + 0.06)
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
