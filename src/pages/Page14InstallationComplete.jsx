/**
 * PAGE 14 — Installation Complete.
 *
 * The end of the physical phase. The completed pole stays primary on the right
 * and one glass sheet on the left says what was commissioned — two numbers,
 * because those are the two decisions the learner actually made. Everything
 * else about the install is either already visible in the model or belongs to
 * the performance review at the very end.
 *
 * The coverage dome is gone from here. It had its page, and repeating it under
 * a completion summary turns a consequence into wallpaper.
 */
export default function Page14InstallationComplete({
  height, downtilt, onContinue, busy, children,
}) {
  return (
    <section className="fm-page p14" aria-label="Installation complete">
      {/* The finished hardware, in its own frame on the right. */}
      <div className="p14-view">{children}</div>

      <div className="fm-glass p14-sheet">
        <h1 className="p14-title">Installation complete</h1>
        <p className="p14-lead">LP12 commissioned successfully.</p>

        <hr className="p14-rule" />

        <dl className="p14-figures">
          <div>
            <dt>Mount height</dt>
            <dd>{height.toFixed(1)} m</dd>
          </div>
          <div>
            <dt>Downtilt</dt>
            <dd>{downtilt}°</dd>
          </div>
        </dl>

        {/* The one page whose reference render and replication code agree on a
            filled button, so this is the one that gets it. */}
        <button className="fm-btn fm-btn--primary p14-cta" type="button"
                onClick={onContinue} disabled={busy}>
          Continue to Network Tuning
          <span className="fm-btn-arrow" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
                    strokeLinejoin="round" d="M4 12h15m-6-6 6 6-6 6" />
            </svg>
          </span>
        </button>
      </div>
    </section>
  )
}
