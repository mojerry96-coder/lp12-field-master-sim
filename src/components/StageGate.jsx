import { Component, useCallback, useEffect, useRef, useState } from 'react'
import { preload } from '../lib/preloader'

/**
 * Holds a stage behind a branded loading state until it is wholly ready, then
 * reveals the finished scene in one transition.
 *
 * The fault this fixes is the interface assembling itself in front of the
 * learner — header, then background, then the model, then the buttons — which
 * reads as broken even though every individual piece is working. A stage is
 * either not here yet or it is complete.
 *
 * "Ready" is two things, and both are required:
 *
 *   assets    the priority band is fetched AND decoded (see preloader)
 *   scene     the stage says so, via ready={}. For 3D stages that means the
 *             GLB is parsed, materials assigned, clips registered and the
 *             shaders compiled — a stage that reports ready on mount would
 *             just move the pop-in behind a shorter curtain
 *
 * There is a timeout because a hung fetch otherwise leaves the learner on a
 * loading screen with no way out and nothing to read.
 */

const TIMEOUT_MS = 25_000

export default function StageGate({
  name, priority, ready = true, onRetreat, children,
}) {
  const [progress, setProgress] = useState(0)
  const [assetsOk, setAssetsOk] = useState(false)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const timer = useRef(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setAssetsOk(false)
    setProgress(0)

    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (!cancelled) setError(new Error('timeout'))
    }, TIMEOUT_MS)

    preload(priority, (p) => { if (!cancelled) setProgress(p) })
      .then(() => { if (!cancelled) setAssetsOk(true) })
      .catch((err) => { if (!cancelled) setError(err) })
      .finally(() => clearTimeout(timer.current))

    return () => { cancelled = true; clearTimeout(timer.current) }
  }, [priority, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const shown = assetsOk && ready && !error

  return (
    <StageErrorBoundary name={name} onRetry={retry} onRetreat={onRetreat}>
      {/* The stage is always mounted. It has to be: a 3D stage cannot parse a
          GLB, build materials and compile shaders in order to report ready if
          it has not been mounted yet. It is hidden, not absent. */}
      <div className={`stage-reveal${shown ? ' is-shown' : ''}`}
           aria-hidden={shown ? undefined : 'true'}
           // Nothing behind the curtain may be clicked, tabbed to or read out.
           inert={!shown}>
        {children}
      </div>

      {!shown && (
        error
          ? <GateError name={name} onRetry={retry} onRetreat={onRetreat} />
          : <GateLoading name={name} progress={progress} ready={ready} />
      )}
    </StageErrorBoundary>
  )
}

function GateLoading({ name, progress, ready }) {
  // Assets are most of the wait, so they own most of the bar. The last tenth
  // is the scene preparing itself — parse, materials, shader compile — which
  // has no progress to report but is not instant either.
  const shown = ready ? progress : Math.min(progress, 0.9)
  return (
    <div className="stage-gate" role="status" aria-live="polite">
      <div className="stage-gate-inner">
        <div className="miva-mark" aria-hidden="true" />
        <p className="stage-gate-name">{name}</p>
        <span className="stage-gate-line">
          <i style={{ transform: `scaleX(${shown})` }} />
        </span>
        <span className="stage-gate-pct">{Math.round(shown * 100)}%</span>
      </div>
    </div>
  )
}

function GateError({ name, onRetry, onRetreat }) {
  return (
    <div className="stage-gate" role="alert">
      <div className="stage-gate-inner stage-gate-error">
        <div className="miva-mark" aria-hidden="true" />
        <p className="stage-gate-name">{name}</p>
        <p>We couldn’t prepare this stage. Check your connection and try again.</p>
        <div className="stage-gate-actions">
          <button type="button" className="is-primary cursor-target" onClick={onRetry}>
            Retry
          </button>
          {onRetreat && (
            <button type="button" className="cursor-target" onClick={onRetreat}>
              Return to previous stage
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Catches throws from inside the stage — a GLB that parses but has no scene,
 * a material that fails to compile — and offers the same two actions the
 * asset path offers, rather than unmounting the whole app to a blank page.
 */
class StageErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { crashed: false }
  }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(err, info) {
    console.error(`[LP12] stage "${this.props.name}" crashed:`, err, info)
  }

  render() {
    if (this.state.crashed) {
      return (
        <GateError
          name={this.props.name}
          onRetry={() => { this.setState({ crashed: false }); this.props.onRetry?.() }}
          onRetreat={this.props.onRetreat}
        />
      )
    }
    return this.props.children
  }
}
