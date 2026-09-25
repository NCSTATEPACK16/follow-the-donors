/**
 * Refuse to build a site with no data.
 *
 * `web/public/data` is gitignored — it is a local copy (or symlink) of the
 * pipeline's data/artifacts/, gigabytes upstream of it are never committed.
 * So a build that starts from a git checkout, which is what a Netlify
 * git-triggered build is, has no artifacts: it compiles, it publishes, and
 * every fetch on the live map 404s. Nothing fails loudly anywhere.
 *
 * netlify.toml runs this before the build. A failed Netlify build publishes
 * nothing and leaves the last good deploy live, which is the safe outcome.
 * Deploying from a machine that has the artifacts (`netlify deploy --prod
 * --dir web/dist`, or `--build` there) is unaffected: the files are present.
 *
 * Reads the cycle and version from src/lib/config.ts rather than restating
 * them, so this cannot drift from what the app actually fetches.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..")
const config = readFileSync(join(WEB, "src/lib/config.ts"), "utf8")
const version = config.match(/ARTIFACT_VERSION\s*=\s*"([^"]+)"/)?.[1]
const cycle = config.match(/DEFAULT_CYCLE:\s*Cycle\s*=\s*"([^"]+)"/)?.[1]
if (!version || !cycle) {
  console.error("require-data: could not read ARTIFACT_VERSION / DEFAULT_CYCLE from src/lib/config.ts")
  process.exit(2)
}
// If the app reads data from elsewhere (Phase 7's R2 Worker), the local
// copy is not needed and this check does not apply.
if (process.env.VITE_DATA_BASE_URL) {
  console.log(`require-data: VITE_DATA_BASE_URL=${process.env.VITE_DATA_BASE_URL}, not checking public/data`)
  process.exit(0)
}
const need = [
  `districts-${cycle}-${version}.geojson`, `states-${cycle}-${version}.geojson`,
  `meta-${cycle}-${version}.json`, `sectors-${cycle}-${version}.json`,
  `senate-${cycle}-${version}.json`,
]
const missing = need.filter((f) => !existsSync(join(WEB, "public/data", f)))
if (missing.length) {
  console.error(`require-data: web/public/data is missing ${missing.join(", ")}.
This checkout has no artifacts, so the site it would build shows no map.
Build and deploy from a machine that has run the pipeline (see ROADMAP.md),
or set VITE_DATA_BASE_URL to where the artifacts are served.`)
  process.exit(1)
}
console.log(`require-data: ${need.length} artifacts present for ${cycle} ${version}`)
