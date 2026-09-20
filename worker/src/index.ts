/**
 * Static-asset Worker in front of the R2 bucket Phase 7 publishes to.
 *
 * No dynamic origin and no secrets: the only input is the request path, the
 * only output is whatever R2 object that path names, and the only decision
 * this file makes is which of two cache lifetimes to attach.
 *
 * Cache headers are NOT uniform, per CLAUDE.md's Publishing section:
 *   - every versioned artifact (districts-2026-v1.geojson, a district page,
 *     ...) is immutable -- a corrected file takes a NEW name, so nobody who
 *     already fetched the old one needs to see the fix, and the object at
 *     this path never changes under a visitor.
 *   - generation.json is the one exception: it may be overwritten in place,
 *     so it gets a short cache instead of a permanent one.
 */

export interface Env {
  ARTIFACTS: R2Bucket
}

const IMMUTABLE = "public, immutable, max-age=31536000"
const SHORT = "public, max-age=3600"

/** The one unversioned sidecar. Matched by filename, not by path, so it
 * works the same whether or not it is ever nested under a prefix. */
const SHORT_CACHE_NAMES = new Set(["generation.json"])

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } })
    }

    const url = new URL(request.url)
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""))
    if (!key) return new Response("Not found", { status: 404 })

    const object = await env.ARTIFACTS.get(key)
    if (!object) return new Response("Not found", { status: 404 })

    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set("etag", object.httpEtag)
    headers.set(
      "cache-control",
      SHORT_CACHE_NAMES.has(key.split("/").pop() ?? "") ? SHORT : IMMUTABLE,
    )

    if (request.method === "HEAD") return new Response(null, { headers })
    return new Response(object.body, { headers })
  },
} satisfies ExportedHandler<Env>
