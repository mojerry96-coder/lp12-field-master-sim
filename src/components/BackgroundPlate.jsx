import { useEffect, useRef, useState } from 'react'

/**
 * The site plate behind everything — a looping aerial of Awolowo Way.
 *
 * The still is kept as the video's poster rather than being replaced outright.
 * It paints on the first frame, before any of the video has decoded, so the
 * scene never opens on an empty box; it is also the fallback when the video
 * cannot play at all. Both are framed identically and both are `object-fit:
 * cover`, so the swap is invisible and the LP12 hotspot — which is positioned
 * from a normalised anchor, not pixels — lands on the same pole either way.
 *
 * The video only earns its cost while the learner is looking at the street. In
 * every later mode the plate is blurred and dimmed behind the model, where
 * moving traffic is invisible and would just be decoding for nothing, so it is
 * paused there and resumed on the way back.
 */
export default function BackgroundPlate({
  imageSrc, videoSrc, focused, reducedMotion = false, onLoad,
}) {
  const videoRef = useRef(null)
  const [videoFailed, setVideoFailed] = useState(false)

  // Motion is the whole point of the video, so under prefers-reduced-motion the
  // still is not merely paused — it is what gets rendered.
  const useVideo = Boolean(videoSrc) && !reducedMotion && !videoFailed

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (focused) {
      el.pause()
      return
    }
    // Autoplay can still be refused (a browser-level media policy, not just the
    // muted attribute). The still is already showing underneath, so a rejected
    // play() is not worth surfacing.
    const attempt = el.play()
    if (attempt?.catch) attempt.catch(() => {})
  }, [focused, useVideo])

  return (
    <div className={`background-image-layer ${focused ? 'is-focused' : ''}`} aria-hidden="true">
      {useVideo ? (
        <video
          ref={videoRef}
          poster={imageSrc}
          src={videoSrc}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          disablePictureInPicture
          onLoadedData={onLoad}
          onError={() => { setVideoFailed(true); onLoad?.() }}
        />
      ) : (
        <img src={imageSrc} alt="" draggable={false} decoding="async"
             fetchPriority="high" onLoad={onLoad} />
      )}
    </div>
  )
}
