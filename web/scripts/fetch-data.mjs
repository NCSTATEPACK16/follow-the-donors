/**
 * Give a git-triggered build its data.
 *
 * `web/public/data` is gitignored, so a Netlify build that starts from a
 * git checkout has no artifacts. The pipeline's output is published instead
 * as one archive on the repo's `data` GitHub Release
 * (`scripts/publish_data.sh`, run on the machine that holds the FEC data),
 * and this downloads and unpacks it before the build.
 *
 * It never decides whether the data is good enough. That stays with
 * require-data.mjs, which runs next and fails the build if an artifact is
 * missing. A failed build publishes nothing and leaves the last good deploy
 * live.
 *
 *   - public/data already present (a local build from the data machine,
 *     where it is a symlink to data/artifacts): left alone.
 *   - DATA_ARCHIVE_URL set: that archive is used instead of the release.
 *   - download fails: exit 1, with the reason.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(WEB, "public/data")
const URL_ = process.env.DATA_ARCHIVE_URL ??
  "https://github.com/NCSTATEPACK16/follow-the-donors/releases/download/data/artifacts.tar.gz"

if (existsSync(OUT) && readdirSync(OUT).length > 0) {
  console.log("fetch-data: web/public/data is already present, not downloading")
  process.exit(0)
}

console.log(`fetch-data: downloading ${URL_}`)
let res
try {
  res = await fetch(URL_, { redirect: "follow" })
} catch (e) {
  console.error(`fetch-data: could not reach ${URL_}: ${e.message}`)
  process.exit(1)
}
if (!res.ok) {
  console.error(`fetch-data: ${URL_} answered ${res.status}.
Has the data been published? On the data machine, after the pipeline:
  scripts/publish_data.sh`)
  process.exit(1)
}
const buf = Buffer.from(await res.arrayBuffer())
const tmp = join(tmpdir(), `artifacts-${process.pid}.tar.gz`)
writeFileSync(tmp, buf)
mkdirSync(OUT, { recursive: true })
try {
  execFileSync("tar", ["-xzf", tmp, "-C", OUT], { stdio: "inherit" })
} catch {
  rmSync(OUT, { recursive: true, force: true })
  console.error("fetch-data: the archive did not unpack")
  process.exit(1)
} finally {
  rmSync(tmp, { force: true })
}
console.log(`fetch-data: ${(buf.length / 1e6).toFixed(1)} MB unpacked into web/public/data`)
