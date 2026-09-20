/**
 * District/state/candidate search and ZIP lookup — the v1 additions the
 * plan's Task 5 Step 5 calls for. Neither exists in any prototype HTML.
 *
 * The ZIP answer is never upgraded past what stage 10 already labelled:
 * an exact (`zcta_intersection`) and a prefix (`zip3_prefix`) answer stay
 * visibly different rows, never merged into one, per CLAUDE.md's ZIP
 * invariant.
 */
import { ASSETS, type Cycle } from "./config"

export interface SearchCandidate {
  cand_id: string
  cand_name: string
  cand_party: string
}

export interface SearchEntry {
  geoid: string
  state: string
  cd: string
  district_name: string
  candidates: SearchCandidate[]
}

export interface ZipMatch {
  district_geoid: string
  resolution: "zcta_intersection" | "zip3_prefix" | "unresolved"
  overlap_share?: number
  is_primary?: boolean
  supporting_zips?: number
}

export interface ZipCrosswalk {
  by_zip5: Record<string, ZipMatch[]>
  by_zip3: Record<string, ZipMatch[]>
}

const searchCache = new Map<Cycle, Promise<SearchEntry[]>>()
let zipPromise: Promise<ZipCrosswalk> | null = null

export function fetchSearchIndex(cycle: Cycle): Promise<SearchEntry[]> {
  let p = searchCache.get(cycle)
  if (!p) {
    p = fetch(ASSETS.search(cycle)).then((r) => r.json())
    searchCache.set(cycle, p)
  }
  return p
}

/** Not cycle-specific — the crosswalk is geography, not money. */
export function fetchZipCrosswalk(): Promise<ZipCrosswalk> {
  if (!zipPromise) zipPromise = fetch(ASSETS.zipDistricts()).then((r) => r.json())
  return zipPromise
}

export interface SearchResult {
  entry: SearchEntry
  /** Which field matched, for a result label. */
  matchedOn: "location" | "candidate"
  matchedCandidate?: string
}

/**
 * District/state/candidate search over stage 10's index. Deliberately a
 * plain substring match, case-insensitive: the index is 441 rows, and a
 * fuzzy-match library is not a proportionate answer to that size.
 */
export function searchDistricts(index: SearchEntry[], query: string, limit = 8): SearchResult[] {
  const q = query.trim().toLowerCase()
  if (q.length < 1) return []
  const out: SearchResult[] = []
  for (const entry of index) {
    const label = `${entry.state}-${entry.cd} ${entry.district_name}`.toLowerCase()
    if (label.includes(q) || entry.state.toLowerCase() === q) {
      out.push({ entry, matchedOn: "location" })
      continue
    }
    const cand = entry.candidates.find((c) => c.cand_name.toLowerCase().includes(q))
    if (cand) out.push({ entry, matchedOn: "candidate", matchedCandidate: cand.cand_name })
    if (out.length >= limit) break
  }
  return out.slice(0, limit)
}

/**
 * (matches, resolution) for a 5-digit ZIP. Exact ZCTA intersection first;
 * the ZIP3 prefix fallback only when the exact lookup is empty. The two are
 * never merged — the caller renders `resolution` so the reader can tell
 * which kind of answer they got.
 */
export function resolveZip(crosswalk: ZipCrosswalk, zip5: string): ZipMatch[] {
  const z = zip5.trim()
  if (!/^\d{5}$/.test(z)) return []
  const exact = crosswalk.by_zip5[z]
  if (exact && exact.length) return exact
  const zip3 = z.slice(0, 3)
  return crosswalk.by_zip3[zip3] || []
}
