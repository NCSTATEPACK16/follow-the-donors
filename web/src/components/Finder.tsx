import { useEffect, useState, type RefObject } from "react"
import {
  fetchSearchIndex, fetchZipCrosswalk, searchDistricts, resolveZip,
  type SearchEntry, type SearchResult, type ZipCrosswalk, type ZipMatch,
} from "../lib/finder"
import type { Cycle } from "../lib/config"

interface Controller {
  goToDistrict: (geoid: string) => void
  goToState: (state: string) => void
}

/**
 * Search (district/state/candidate) and ZIP entry — the v1 additions the
 * plan's Task 5 Step 5 calls for. Neither is in any prototype HTML.
 *
 * Deliberately outside the imperative WebGL controller: this is ordinary
 * React state driving ordinary DOM, and it only ever reaches into the map
 * through the two callbacks on `controller`.
 */
export function Finder({ controller, cycle }: { controller: RefObject<Controller | null>; cycle: Cycle }) {
  const [index, setIndex] = useState<SearchEntry[] | null>(null)
  const [zips, setZips] = useState<ZipCrosswalk | null>(null)
  const [query, setQuery] = useState("")
  const [zip, setZip] = useState("")

  useEffect(() => {
    let cancelled = false
    fetchSearchIndex(cycle).then((v) => { if (!cancelled) setIndex(v) })
    fetchZipCrosswalk().then((v) => { if (!cancelled) setZips(v) })
    return () => { cancelled = true }
  }, [cycle])

  const results: SearchResult[] = index ? searchDistricts(index, query) : []
  const zipMatches: ZipMatch[] = zips ? resolveZip(zips, zip) : []
  const zipTried = /^\d{5}$/.test(zip.trim())

  const pick = (geoid: string) => {
    controller.current?.goToDistrict(geoid)
    setQuery(""); setZip("")
  }

  return (
    <div className="finder">
      <div className="finder-row">
        <div>
          <label className="picker-lab" htmlFor="finder-search">Find a district, state or candidate</label>
          <input
            id="finder-search" type="text" placeholder="e.g. TX-35, California, Ossoff"
            value={query} onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div>
          <label className="picker-lab" htmlFor="finder-zip">Look up a ZIP code</label>
          <input
            id="finder-zip" type="tel" inputMode="numeric" maxLength={5} placeholder="94103"
            value={zip} onChange={(e) => setZip(e.target.value.replace(/[^\d]/g, ""))}
          />
        </div>
      </div>

      {query.trim().length > 0 && (
        results.length ? (
          <ul className="finder-results">
            {results.map((r) => (
              <li key={r.entry.geoid}>
                <button type="button" onClick={() => pick(r.entry.geoid)}>
                  <strong>{r.entry.state}-{r.entry.cd}</strong> {r.entry.district_name}
                  {r.matchedOn === "candidate" && r.matchedCandidate
                    ? ` — ${r.matchedCandidate}` : ""}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="finder-empty">No match in the {cycle} index.</p>
      )}

      {zipTried && (
        zipMatches.length ? (
          <ul className="finder-results">
            {zipMatches.map((m, i) => (
              <li key={`${m.district_geoid}-${i}`}>
                <button type="button" onClick={() => pick(m.district_geoid)} className="finder-zip-row">
                  <span
                    className={`finder-zip-tag ${m.resolution === "zcta_intersection" ? "is-exact" : "is-prefix"}`}
                  >
                    {m.resolution === "zcta_intersection" ? "exact" : "ZIP3 prefix — wider than the truth"}
                  </span>
                  <span>district {m.district_geoid}{m.is_primary ? " (primary)" : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="finder-empty">No district resolves for that ZIP, even by prefix.</p>
      )}
    </div>
  )
}
