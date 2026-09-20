# Stage 07 — publishable artifacts

Cycles: 2024, 2026
Gated: 2024
Elapsed: 7.8s


## 2024

| artifact | size |
|---|---|
| districts-2024-v1.geojson | 1.47 MB |
| states-2024-v1.geojson | 0.61 MB |
| sectors-2024-v1.json | 0.15 MB |
| senate-2024-v1.json | 0.05 MB |
| meta-2024-v1.json | 0.00 MB |

441 district features · $420,315,216 · **35.42% on a superseded map** · reconciliation -0.72%.

Senate: 50 states · $89,745,312 · 33 up / 17 banked · 0 correction(s).


## 2026

| artifact | size |
|---|---|
| districts-2026-v1.geojson | 1.47 MB |
| states-2026-v1.geojson | 0.61 MB |
| sectors-2026-v1.json | 0.15 MB |
| senate-2026-v1.json | 0.05 MB |
| meta-2026-v1.json | 0.00 MB |

441 district features · $328,788,436 · **37.33% on a superseded map** · reconciliation +5.16%.

Senate: 50 states · $80,871,118 · 35 up / 15 banked · 1 correction(s).


## Acceptance

| check | result | detail |
|---|---|---|
| 2024 districts artifact has exactly 441 features | PASS | 441 features |
| 2024 feature pac_cents sums to district_totals × 100 exactly | PASS | 42031521600 vs 42031521600 |
| 2024 district bucket of attribution equals the artifact total | PASS | 42031521600 vs 42031521600 |
| 2024 Senate artifact equals candidate_totals to the cent | PASS | 8974531200 vs 8974531200 |
| 2024 every feature carries map_status, map_vintage, legal_status | PASS | 0 features missing a vintage field |
| 2024 map_status counts match district_vintage exactly | PASS | {'cd119_superseded': 173, 'cd119_contested': 19, 'cd119_current': 249} vs {'cd119_superseded': 173, 'cd119_contested': 19, 'cd119_current': 249} |
| 2024 every ring is wound for d3-geo (max area < 0.1 sr) | PASS | max 0.03721884756295505 sr over 497 features (1226 rings rewound) |
| 2024 Senate states sum to 50 | PASS | 50 states |
| 2024 every ID in every artifact is a JSON string | PASS | 0 non-string ID(s) |
| 2026 districts artifact has exactly 441 features | PASS | 441 features |
| 2026 feature pac_cents sums to district_totals × 100 exactly | PASS | 32878843600 vs 32878843600 |
| 2026 district bucket of attribution equals the artifact total | PASS | 32878843600 vs 32878843600 |
| 2026 Senate artifact equals candidate_totals to the cent | PASS | 8087111800 vs 8087111800 |
| 2026 every feature carries map_status, map_vintage, legal_status | PASS | 0 features missing a vintage field |
| 2026 map_status counts match district_vintage exactly | PASS | {'cd119_superseded': 173, 'cd119_contested': 19, 'cd119_current': 249} vs {'cd119_superseded': 173, 'cd119_contested': 19, 'cd119_current': 249} |
| 2026 every ring is wound for d3-geo (max area < 0.1 sr) | PASS | max 0.03721884756295505 sr over 497 features (1226 rings rewound) |
| 2026 Senate states sum to 50 | PASS | 50 states |
| 2026 DC->MD Senate correction is recorded, 35 seats up / 15 banked | PASS | 1 correction(s), 35 up / 15 banked |
| 2026 every ID in every artifact is a JSON string | PASS | 0 non-string ID(s) |

Result: **PASS**
