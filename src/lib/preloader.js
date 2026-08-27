import { useGLTF } from '@react-three/drei'
import { GLTFLoader, DRACOLoader } from 'three-stdlib'
import { assetsFor, bytesFor, KIND, P1, P2, P3 } from './assetManifest'

// Re-exported so a caller needs one import to say "warm the tablet band"
// rather than reaching into the manifest for the constant and the loader for
// the verb.
export { P1, P2, P3 }

/**
 * Staged preloading against the asset manifest.
 *
 * Progress is weighted by measured byte size, not by file count. Counting
 * files makes a 6 KB JSON worth as much as a 1.5 MB GLB, so the bar reaches
 * 90% almost immediately and then sits there for the whole real wait — which
 * is worse than no bar, because it reads as a hang.
 *
 * Images are DECODED, not merely fetched. A downloaded-but-undecoded image
 * still costs a main-thread stall the first time it is painted, which is the
 * pop-in this is meant to remove. `img.decode()` is what makes "ready" true.
 *
 * GLBs go through drei's useGLTF.preload so the parsed result lands in the
 * same cache the components read from. Fetching them with plain fetch() would
 * warm the HTTP cache and still leave the parse to happen at mount.
 */

/**
 * One loader for the whole session, configured the same way drei configures
 * its own — including the LOCAL Draco decoder. A second decoder path here
 * would fetch a second copy of the wasm.
 */
let _loader = null
function gltfLoader() {
  if (!_loader) {
    _loader = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath('/draco/')
    _loader.setDRACOLoader(draco)
  }
  return _loader
}

const done = new Set()          // urls already prepared, across the session
const inflight = new Map()      // url -> promise, so two callers share one load

/* A decode that cannot hang the band it belongs to.
 *
 * `img.decode()` does not settle at all while the document is hidden — it does
 * not reject, it simply never resolves, because a hidden page has nothing to
 * decode into. A learner who opens the simulation in a background tab would
 * therefore sit on "Preparing simulation - 2%" until they focused the tab,
 * with no error and no way to tell what was wrong.
 *
 * The image is already downloaded by the time we get here, so the only thing
 * decoding buys is avoiding a first-paint stall. That is worth waiting for
 * when it can happen and worth nothing when it cannot, so: skip it outright
 * on a hidden page, and put a ceiling on it everywhere else. */
const DECODE_CEILING_MS = 2000

function decodeSoon(img) {
  if (!img.decode || document.hidden) return Promise.resolve()
  return Promise.race([
    // decode() rejects on some browsers for images already decoded; a
    // resolved load is good enough in that case.
    img.decode().catch(() => {}),
    new Promise((r) => setTimeout(r, DECODE_CEILING_MS)),
  ])
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => { decodeSoon(img).then(resolve) }
    img.onerror = () => reject(new Error(`image failed: ${url}`))
    img.src = url
  })
}

async function loadOne(asset) {
  switch (asset.kind) {
    case KIND.image:
      return loadImage(asset.url)
    case KIND.gltf:
      // Loaded through a real GLTFLoader, not fetch().
      //
      // useGLTF.preload is fire-and-forget, so it cannot say when a model is
      // ready. Pairing it with a plain fetch() did settle, but it opened a
      // SECOND request path for the same file — the bytes came from cache, so
      // it cost no network, but the file was being requested twice for no
      // reason. Going through the loader means one path, a promise that
      // resolves on a parsed document, and — with THREE.Cache on — drei's
      // later useGLTF for the same URL reads the cached buffer instead of
      // asking again.
      await gltfLoader().loadAsync(asset.url)
      useGLTF.preload(asset.url)
      return undefined
    case KIND.json:
      await fetch(asset.url).then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${asset.url}`)
        return r.json()
      })
      return undefined
    default:
      return undefined
  }
}

function track(asset) {
  if (done.has(asset.url)) return Promise.resolve()
  if (inflight.has(asset.url)) return inflight.get(asset.url)
  const p = loadOne(asset)
    .then(() => { done.add(asset.url) })
    .finally(() => { inflight.delete(asset.url) })
  inflight.set(asset.url, p)
  return p
}

/**
 * Load one priority band.
 *
 * onProgress receives 0..1 weighted by bytes. Rejects with the list of failed
 * assets rather than the first error, so a stage can report everything that is
 * missing instead of one symptom at a time.
 */
export function preload(priority, onProgress) {
  const assets = assetsFor(priority)
  const total = bytesFor(priority) || 1
  let loaded = 0
  const failures = []

  const jobs = assets.map((a) => track(a)
    .then(() => { loaded += a.bytes || 0 })
    .catch((err) => { failures.push({ asset: a, err }); loaded += a.bytes || 0 })
    .finally(() => onProgress?.(Math.min(1, loaded / total))))

  return Promise.all(jobs).then(() => {
    if (failures.length) {
      const e = new Error(`${failures.length} asset(s) failed to prepare`)
      e.failures = failures
      throw e
    }
  })
}

/** True when every asset in a band is already prepared. */
export function isReady(priority) {
  return assetsFor(priority).every((a) => done.has(a.url))
}

/** Kick a band off without waiting, for background bands. */
export function warm(priority) {
  return preload(priority).catch(() => { /* background: surfaced at the gate */ })
}

/** Test/debug view of what the session has prepared. */
export function preparedUrls() {
  return [...done]
}

/**
 * Dev-only handle, matching the store's `__lp12`.
 *
 * The failure and retry paths are the ones a learner is most likely to hit on
 * a bad connection and the least likely to be exercised in development, so
 * there has to be a way to trigger them deliberately. `forget()` drops the
 * prepared set so a band reloads; nothing here ships to production.
 */
if (import.meta.env.DEV) {
  globalThis.__lp12assets = {
    prepared: preparedUrls,
    forget: (url) => (url ? done.delete(url) : done.clear()),
    isReady,
  }
}
