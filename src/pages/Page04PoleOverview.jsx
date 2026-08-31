
/**
 * PAGE 04 — Pole Overview / Manual Orbit.
 *
 * The first page where the subject is the live model rather than a plate. The
 * pole holds the right of the frame, the street stays behind it — this is the
 * last page before isolation, and the point of inspecting the column here is
 * that it is still standing in the street it serves.
 *
 * Orbit used to live here and now lives on Page 13. Inspecting a bare column
 * from every side teaches little; the coverage dome is the thing whose shape
 * only reads once you can walk around it, so the control moved to the page
 * that rewards it.
 */

export default function Page04PoleOverview({ onBeginInstallation, busy, children }) {
  return (
    <section className="fm-page p04" aria-label="Pole overview">
      {/* The live model. Held to the right 62% so the pole composes against
          the title rather than sitting under it. */}
      <div className="p04-viewport">{children}</div>

      {/* No mark slot: see Page01Welcome. The wordmark sits on the same left
          edge as the title, subtitle and location line below it. */}
      <div className="p04-brand">MIVA OPEN UNIVERSITY</div>

      <div className="p04-stack">
        <h1 className="p04-title"><span>POLE</span> <span>OVERVIEW</span></h1>
        <p className="p04-sub">LP12 Small-Cell Installation</p>
        <p className="p04-where">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0
                     9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
          </svg>
          Awolowo Way · Ikeja, Lagos
        </p>
      </div>

      <div className="fm-glass p04-actions">
        <button type="button" className="fm-btn p04-begin"
                onClick={onBeginInstallation} disabled={busy}>
          <span className="fm-btn-glyph" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M8 5.5v13l11-6.5z" />
            </svg>
          </span>
          Begin Installation
        </button>
      </div>
    </section>
  )
}
