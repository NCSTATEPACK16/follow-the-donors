/**
 * Versioned artifact names.
 *
 * MUST stay in lockstep with the filenames scripts/07_artifacts.py,
 * scripts/09_district_pages.py and scripts/10_sidecars.py actually write to
 * data/artifacts/, and with data/artifacts/generation.json's manifest. A
 * mismatch 404s in production and nowhere else — CLAUDE.md's "Publishing"
 * section calls this out by name. scripts/11_upload_r2.py (Phase 7, not run
 * yet) asserts this file against generation.json before it uploads anything.
 *
 * `ARTIFACT_VERSION` bumps only when an artifact's SHAPE changes, never for a
 * data refresh — R2 objects are published immutable, so a corrected file
 * takes a new name rather than overwriting one that's already been fetched.
 */

export const ARTIFACT_VERSION = "v1"

export const CYCLES = ["2024", "2026"] as const
export type Cycle = (typeof CYCLES)[number]

/** The user's standing explicit choice from round 2: 2026 is the ungated,
 * mid-cycle default. Flipping this is a one-line change, not a rebuild,
 * because both cycles' artifacts are always built. */
export const DEFAULT_CYCLE: Cycle = "2026"

/**
 * Where artifact JSON/GeoJSON is fetched from.
 *
 * Phase 7 (uploading to R2) has not run — there is no CDN URL yet. Until it
 * does, this resolves relative to the site itself: `web/public/data` is a
 * local copy (or symlink, in dev) of data/artifacts/, the same pattern
 * web/.gitignore already reserves (`web/public/data`, `web/public/tiles`).
 * That makes a plain static deploy (Netlify, a local `vite preview`) work
 * with zero cloud dependency, and keeps $0 infrastructure true before R2
 * credentials exist. Once Phase 7 runs, set VITE_DATA_BASE_URL to the R2
 * Worker's origin and nothing else here changes.
 */
export const DATA_BASE_URL: string =
  (import.meta.env.VITE_DATA_BASE_URL as string | undefined) ?? "/data"

function assetPath(name: string): string {
  return `${DATA_BASE_URL}/${name}`
}

export const ASSETS = {
  districts: (cycle: Cycle) => assetPath(`districts-${cycle}-${ARTIFACT_VERSION}.geojson`),
  states: (cycle: Cycle) => assetPath(`states-${cycle}-${ARTIFACT_VERSION}.geojson`),
  sectors: (cycle: Cycle) => assetPath(`sectors-${cycle}-${ARTIFACT_VERSION}.json`),
  senate: (cycle: Cycle) => assetPath(`senate-${cycle}-${ARTIFACT_VERSION}.json`),
  meta: (cycle: Cycle) => assetPath(`meta-${cycle}-${ARTIFACT_VERSION}.json`),
  search: (cycle: Cycle) => assetPath(`search-${cycle}-${ARTIFACT_VERSION}.json`),
  stats: (cycle: Cycle) => assetPath(`stats-${cycle}-${ARTIFACT_VERSION}.json`),
  zipDistricts: () => assetPath(`zip-districts-${ARTIFACT_VERSION}.json`),
  districtPage: (geoid: string, cycle: Cycle) =>
    assetPath(`districts/${geoid}-${cycle}-${ARTIFACT_VERSION}.json`),
  /** The one unversioned sidecar — 1-hour cache, may be overwritten in
   * place. Everything else above is immutable and versioned. */
  generation: () => assetPath("generation.json"),
}
