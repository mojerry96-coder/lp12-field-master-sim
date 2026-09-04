import { urlFor } from '../lib/assetManifest'
import ReferenceStage from '../reference/ReferenceStage'
import { ArrowRight, PinIcon } from '../reference/RefIcons'
import '../styles/ref-page14.css'

/**
 * PAGE 03 in the kit — Installation Complete, against
 * `03-installation-complete.png`.
 *
 * A two-column editorial composition. The kit's coordinates: brand at 53/49,
 * the FIELD MASTER headline at 51/109 and deliberately OUTSIDE the result card,
 * the card itself at 50/443 measuring 470 x 396 on a 29px radius, and the media
 * viewport at 577/104 measuring 1022 x 750 on a 32px radius.
 *
 * WHAT GOES IN THE VIEWPORT. The reference shows a photograph of a finished
 * install, and that is what this now is: the kit's own
 * `installation-complete-scene` prompt, generated. It replaces the live 3D pole
 * that sat here before.
 *
 * The numbers beside it are still the learner's — mount height and downtilt
 * come from what they set — so the page reports their work even though the
 * photograph is generic. That is the trade the reference asks for: a finished
 * install as a photograph reads as the real thing on a real street, which a
 * studio render of a bare pole does not.
 *
 * The metrics keep the kit's emphasis: values darker and heavier than labels.
 */

/* `children` is the shared 3D canvas the install route hands every stage. It is
   deliberately not rendered here: this page is a photograph now, and keeping a
   second WebGL context alive behind an opaque image costs a frame budget for
   something nobody sees. Back to the coverage stage remounts it, and the GLB is
   already in useGLTF's cache, so the return trip is not a reload. */
export default function Page14InstallationComplete({
  height, downtilt, onContinue, busy,
}) {
  return (
    <ReferenceStage className="p14r" label="Installation complete">
      <div className="p14r-plate" aria-hidden="true" />

      <div className="fm-brand p14r-brand">
        <strong>MIVA</strong><span>OPEN UNIVERSITY</span>
      </div>

      <div className="p14r-copy">
        <h1 className="p14r-title"><span>FIELD</span> <span>MASTER</span></h1>
        <p className="p14r-sub">LP12 Small-Cell Installation</p>
        <p className="p14r-where">
          <PinIcon size={20} />
          <span>Awolowo Way<i /> · <i />Ikeja, Lagos</span>
        </p>
        <div className="p14r-rule" aria-hidden="true"><i /><b /></div>
        <p className="p14r-tagline">Practice today.<br />A more connected tomorrow.</p>
      </div>

      {/* The finished install, framed to the reference's viewport. */}
      <div className="p14r-view">
        <img src={urlFor('install-plate')}
             alt="The commissioned LP12 on its lighting column beside the office building" />
      </div>

      <section className="fm-glass p14r-card">
        <h2 className="p14r-card-title">Installation<br />complete</h2>
        <p className="p14r-card-sub">LP12 commissioned successfully.</p>

        <div className="fm-hairline p14r-card-line" />

        <dl className="p14r-metrics">
          <div><dt>Mount height</dt><dd>{height.toFixed(1)} m</dd></div>
          <div><dt>Downtilt</dt><dd>{downtilt}°</dd></div>
        </dl>

        <button className="fm-btn fm-btn-primary p14r-continue" type="button"
                onClick={onContinue} disabled={busy}>
          <span>Continue to Network Tuning</span>
          <ArrowRight size={24} />
        </button>
      </section>
    </ReferenceStage>
  )
}
