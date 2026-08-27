/**
 * PAGE 13 — Network Coverage.
 *
 * The city comes back (2.8), and the point of the page is what the learner's
 * two rig decisions did to it. So the scene carries the whole message and the
 * chrome is two things: a status chip and a way onward. The specification is
 * blunt about the temptation here — "do not build a network dashboard" — and
 * the numbers that would fill one are all derivable from a height and a tilt
 * the learner has already set and confirmed.
 *
 * "Optimal" is not decoration. Both rig gates have to pass before this page can
 * be reached, so by construction the footprint on screen is the correct one;
 * the chip says in words what the dome says in shape, which is also the reason
 * the dome no longer changes hue to signal it.
 */
export default function Page13NetworkCoverage({ onContinue, busy, children }) {
  return (
    <section className="fm-page p13" aria-label="Network coverage">
      <div className="p13-viewport">{children}</div>

      <div className="fm-glass p13-chip">
        <span className="p13-bars" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
        <span className="p13-chip-text">
          <b>Network coverage</b>
          <span className="p13-state">
            <i aria-hidden="true" /> Optimal
          </span>
        </span>
      </div>

      <button className="fm-btn p13-continue" type="button"
              onClick={onContinue} disabled={busy}>
        <span className="fm-btn-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path fill="currentColor" d="M8 5.5v13l11-6.5z" />
          </svg>
        </span>
        Continue
      </button>
    </section>
  )
}
