/**
 * Anchoring overlays onto a background plate drawn with object-fit: cover.
 *
 * Two things sit on the isometric plate at a fixed point in the SCENE — the
 * pole highlight on Page 03 and the coverage footprint that replaces it after
 * the install. Both need the same answer to the same question: where on screen
 * is this point of the image right now?
 *
 * It lived in the old Hotspot component until Page 03 replaced it. It is here
 * rather than in a page because a component should not have to import from a
 * page to borrow a piece of geometry.
 */

/** Natural size of the isometric render the locate page shows. */
export const ISO_SOURCE_SIZE = { width: 2560, height: 1440 }

/**
 * Where the LP12 mounts, in normalised plate coordinates.
 *
 * Not eyeballed: LP12_INSTALL_ANCHOR projected through CAM_ENV_ISOMETRIC with
 * bpy_extras.world_to_camera_view at render time, so an overlay pinned here
 * sits on the actual pole rather than near it. Re-render the isometric and
 * this has to be recomputed with it.
 */
export const ISO_LP12_ANCHOR = { x: 0.5447, y: 0.6281 }

/**
 * object-fit: cover crops the image, so a plain percentage drifts as the
 * viewport shape changes. Recompute the rendered image rectangle instead.
 *
 * Returns the scale alongside the point, because anything drawn at the anchor
 * has to be sized against the same rendered image — a fixed pixel size would
 * swallow the pole on a small window and float beside it on a large one.
 */
export function mapCoverPointToContainer(container, image, point) {
  const scale = Math.max(container.width / image.width, container.height / image.height)
  const renderedWidth = image.width * scale
  const renderedHeight = image.height * scale
  const offsetX = (container.width - renderedWidth) / 2
  const offsetY = (container.height - renderedHeight) / 2
  return {
    left: offsetX + point.x * renderedWidth,
    top: offsetY + point.y * renderedHeight,
    scale,
  }
}
