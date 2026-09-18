# **System Architecture and Product Requirements Document: U.S. Congress Campaign Finance Transparency Platform**

The transition from a localized public funding tracking application, such as "Follow the PPP," to a comprehensive national political donation tracking platform focused on the U.S. Congress demands a paradigm shift in data architecture. Campaign finance data, administered by the Federal Election Commission (FEC), represents one of the most voluminous, complex, and frequently amended datasets in the federal government. To process, resolve, and visualize this information at scale, the system architecture must leverage advanced edge-computing paradigms. Designed entirely for deployment on the Cloudflare Developer Platform (utilizing D1, KV, R2, and Workflows) alongside a Netlify-hosted frontend, this specification details a highly resilient, globally distributed application. The architecture prioritizes low-latency geospatial resolution, aggressive edge-caching to mitigate serverless database costs, and strict data hygiene protocols to untangle the notoriously labyrinthine network of American political spending.

## **1\. Data Architecture & Public APIs**

Establishing an accurate, high-fidelity mapping between citizens, their congressional districts, and the financial networks of their representatives requires synthesizing disparate government and non-profit data endpoints. The architecture bifurcates data acquisition into real-time API integrations for dynamic lookups and scheduled bulk ingestions for complex historical aggregations.

### **Core Data Sources and API Integrations**

The Federal Election Commission provides both a REST API (api.open.fec.gov) and comprehensive bulk data files. The REST API is highly structured, offering granular access to candidates, committees, and specific financial schedules. However, architectural reliance exclusively on the REST API for macro-level aggregation introduces severe limitations. Standard API keys enforce a rate limit of 1,000 calls per hour, and even upgraded keys are capped at 120 calls per minute. When performing deep analytical queries—such as tracing every individual contribution from a specific ZIP code to all federal candidates—the API rate limits render real-time aggregation impossible.  
Consequently, the platform relies on a hybrid model. Real-time REST endpoints provide high-level summaries and candidate metadata, while FEC Bulk Data files form the foundation of the platform's internal analytical database. Furthermore, raw FEC data lacks standardized industry classifications for corporate and political action committee (PAC) donors. To provide contextual industry breakdowns, the system integrates the OpenSecrets API and its proprietary Category Codes (Catcodes), alongside the Congress.gov API for legislative tracking.

| Service Provider | Primary Endpoints / Datasets | Architectural Purpose | Rate Limits & Constraints |
| :---- | :---- | :---- | :---- |
| **OpenFEC REST API** | /v1/candidates/search/, /v1/totals/, /v1/schedules/schedule\_a/by\_size/ | Fetching real-time candidate metadata, official committee IDs, and top-line financial summaries without requiring local aggregation. | 1,000 requests/hour (default), 120 requests/minute (upgraded). Pagination required via last\_index. |
| **FEC Bulk Data** | cm (Committees), cn (Candidates), ccl (Linkage), indiv (Individual), pas2 (PACs) | Nightly ingestion into Cloudflare D1 to support deep, unrestricted relational queries like geographic contribution mapping. | Pipe-delimited (|) files, no quotes, UTF-8. Must process massive row counts (millions per cycle). |
| **OpenSecrets API** | getLegislators, candSector, candIndustry | Mapping opaque corporate PACs and individual employer strings to standardized economic sectors (e.g., Defense, Pharmaceuticals). | Rate limits apply based on API tier. Requires mapping FEC candidate\_id to OpenSecrets CID. |
| **Congress.gov API** | /v3/member/{bioguideId}/sponsored-legislation, /v3/member/{stateCode}/{district} | Retrieving recent legislative activity, bill sponsorship, and voting records to correlate financial backing with legislative action. | Requires API key from api.data.gov. Paged results. |

### **Address-to-District Geocoding Architecture**

A core architectural challenge in political transparency applications is accurately mapping a user to a specific U.S. Representative. Implementing a simple 5-digit ZIP code lookup is fundamentally flawed due to partisan gerrymandering; a single 5-digit ZIP code can intersect multiple congressional districts. To guarantee precision, the platform utilizes a cascading geospatial resolution strategy.  
The primary resolution tier utilizes the U.S. Census Bureau's Geocoding API (geocoding.geo.census.gov). When a user inputs a full street address, the system passes the string to the Census API, which returns exact latitude and longitude coordinates alongside the corresponding Congressional District FIPS code. This provides deterministic accuracy.  
If a user refuses to provide a full street address and inputs a 9-digit ZIP code (ZIP+4), the system utilizes a secondary resolution tier. The backend cross-references the ZIP+4 against USPS crosswalk files, which map 9-digit segments to specific districts with high reliability. Finally, the latitude and longitude coordinates returned by the Census API are verified against the Census Bureau’s TIGER/Line Shapefiles (e.g., tl\_2020\_us\_cd116.zip). These highly detailed geospatial polygons define the exact boundaries of the districts for the current congressional session.  
To minimize latency during this resolution process, the Cloudflare Worker intercepts the request and checks Cloudflare KV for a cached response based on the input address hash or ZIP+4 string. If a cache miss occurs, the Worker queries the Census API, parses the JSON payload, stores the resolved district in KV, and returns the result.

### **Relational Data Model & Schema (Cloudflare D1)**

Cloudflare D1 provides a globally distributed, serverless relational database built upon SQLite. D1 operates on a single-primary model; writes are routed to a primary node, while reads are serviced by read replicas distributed across Cloudflare's global edge network. Because D1 billing is calculated strictly by the number of rows\_read and rows\_written, the schema must be aggressively optimized to prevent full table scans on tables containing millions of campaign finance transactions.  
The relational schema is constructed to enforce strict data integrity and facilitate rapid querying. The design explicitly avoids massive monolithic tables in favor of normalized, purpose-built structures.  
\-- D1 SQLite Schema Initialization Script  
\-- Defer foreign key enforcement during bulk migrations  
PRAGMA defer\_foreign\_keys \= on;

\-- Configure SQLite for edge performance (applied at connection level)  
PRAGMA cache\_size \= \-64000;  
PRAGMA temp\_store \= MEMORY;  
PRAGMA mmap\_size \= 268435456;

CREATE TABLE candidates (  
    candidate\_id TEXT PRIMARY KEY,  
    name TEXT NOT NULL,  
    party\_full TEXT,  
    state TEXT,  
    district TEXT,  
    office TEXT,  
    election\_year INTEGER,  
    incumbent\_challenger\_status TEXT  
);

CREATE TABLE committees (  
    committee\_id TEXT PRIMARY KEY,  
    candidate\_id TEXT,  
    designation\_type TEXT,  
    committee\_type TEXT,  
    party TEXT,  
    FOREIGN KEY(candidate\_id) REFERENCES candidates(candidate\_id)  
);

CREATE TABLE ccl\_linkage (  
    candidate\_id TEXT NOT NULL,  
    committee\_id TEXT NOT NULL,  
    election\_cycle INTEGER NOT NULL,  
    PRIMARY KEY (candidate\_id, committee\_id, election\_cycle),  
    FOREIGN KEY(candidate\_id) REFERENCES candidates(candidate\_id),  
    FOREIGN KEY(committee\_id) REFERENCES committees(committee\_id)  
);

CREATE TABLE indiv\_contributions (  
    sub\_id TEXT PRIMARY KEY,  
    committee\_id TEXT NOT NULL,  
    transaction\_date TEXT,  
    amount REAL NOT NULL,  
    donor\_name TEXT,  
    donor\_city TEXT,  
    donor\_state TEXT,  
    donor\_zip5 TEXT,  
    donor\_zip4 TEXT,  
    employer TEXT,  
    occupation TEXT,  
    transaction\_type TEXT,  
    memo\_cd TEXT,  
    FOREIGN KEY(committee\_id) REFERENCES committees(committee\_id)  
);

CREATE TABLE pac\_contributions (  
    sub\_id TEXT PRIMARY KEY,  
    donor\_committee\_id TEXT NOT NULL,  
    recipient\_committee\_id TEXT NOT NULL,  
    transaction\_date TEXT,  
    amount REAL NOT NULL,  
    transaction\_type TEXT,  
    memo\_cd TEXT,  
    FOREIGN KEY(donor\_committee\_id) REFERENCES committees(committee\_id),  
    FOREIGN KEY(recipient\_committee\_id) REFERENCES committees(committee\_id)  
);

\-- Crucial Covering Indexes to prevent row\_read exhaustion in Cloudflare D1  
CREATE INDEX idx\_candidates\_location ON candidates(state, district);  
CREATE INDEX idx\_indiv\_cmte\_date ON indiv\_contributions(committee\_id, transaction\_date);  
CREATE INDEX idx\_indiv\_geo ON indiv\_contributions(donor\_zip5, committee\_id);  
CREATE INDEX idx\_pac\_recipient ON pac\_contributions(recipient\_committee\_id, amount DESC);

\-- Analyze statistics to optimize the SQLite query planner  
PRAGMA optimize;

To integrate cleanly with the frontend components, the backend API standardizes the output payloads. Below is the JSON schema representing the core response for the /api/representative/summary endpoint, providing the frontend with all necessary data to render the "Who Funds My Rep?" dashboard.  
{  
  "$schema": "http://json-schema.org/draft-07/schema\#",  
  "title": "Representative Financial Summary",  
  "type": "object",  
  "properties": {  
    "bioguide\_id": { "type": "string" },  
    "fec\_candidate\_id": { "type": "string" },  
    "official\_name": { "type": "string" },  
    "state": { "type": "string" },  
    "district": { "type": "string" },  
    "party": { "type": "string" },  
    "financial\_totals": {  
      "type": "object",  
      "properties": {  
        "cycle": { "type": "integer" },  
        "total\_receipts": { "type": "number" },  
        "total\_disbursements": { "type": "number" },  
        "cash\_on\_hand": { "type": "number" },  
        "small\_dollar\_fraction": { "type": "number" }  
      }  
    },  
    "top\_industries": {  
      "type": "array",  
      "items": {  
        "type": "object",  
        "properties": {  
          "industry\_name": { "type": "string" },  
          "catcode": { "type": "string" },  
          "total\_amount": { "type": "number" }  
        }  
      }  
    }  
  },  
  "required": \["fec\_candidate\_id", "official\_name", "financial\_totals"\]  
}

## **2\. Cloudflare Data Ingestion & Caching Strategy**

The operational viability of the platform hinges entirely on its data ingestion and caching architecture. The FEC publishes vast quantities of bulk data containing every individual contribution exceeding $200, alongside all PAC transfers and operating expenditures. Attempting to ingest this data via standard serverless functions invariably triggers execution timeouts.

### **Ingestion Pipeline via Cloudflare Workflows**

Standard Cloudflare Workers triggered by Cron Events are subject to a 15-minute maximum execution limit. Extracting, normalizing, and loading millions of pipe-delimited records cannot reliably complete within this window. To solve this, the architecture implements Cloudflare Workflows, a durable execution engine designed specifically for multi-step, long-running processes. Workflows persist state across step boundaries, allowing execution to sleep, wait for external events, and resume exactly where it left off in the event of an isolate recycle.  
The ingestion workflow is orchestrated into the following discrete, idempotent steps:

| Workflow Step | Execution Logic | Error Handling & Resilience |
| :---- | :---- | :---- |
| **1\. Fetch & Archive** | Downloads the latest .zip bulk files (indivYY.zip, pas2YY.zip, cclYY.zip) from the FEC bulk data repository. The raw archives are immediately written to Cloudflare R2 object storage to ensure an immutable data lake exists independent of the database. | Built-in retry logic catches network timeouts from the FEC servers. If a download fails, the workflow sleeps and retries with exponential backoff. |
| **2\. Stream & Parse** | Streams the archived .zip files directly from R2 into memory, unzipping and parsing the pipe-delimited text files line by line. | To bypass the by\_date duplication bug inherent in FEC indiv files (where records appear both in the main itcont.txt file and nested date folders), the parser explicitly ignores the by\_date/ directory structure. |
| **3\. Normalize & Cleanse** | Normalizes date strings (converting varying formats like MMDDYYYY and MM/DD/YYYY into strict YYYY-MM-DD ISO formats) and splits 9-digit ZIP codes into standard 5-digit and \+4 columns. | Data type coercion errors are logged to a dead-letter queue (Cloudflare Queues) for manual inspection, preventing the entire batch from failing. |
| **4\. Batch Insertion** | Compiles normalized rows into arrays and executes D1's Batch API. Using db.batch() with INSERT OR IGNORE on the sub\_id primary key ensures duplicate records introduced by overlapping FEC files are silently dropped without violating constraints. | Transactions are bounded to safe parameter limits (typically 10,000 to 50,000 rows per batch) to prevent D1 memory exhaustion and too many SQL variables errors. |

### **Storage Segregation Strategy**

Storing all data uniformly in a relational database at the edge is financially and computationally inefficient. The architecture enforces a strict tripartite segregation of data across Cloudflare's specific storage primitives.  
Cloudflare D1 serves as the central relational engine. It exclusively houses normalized tables required for complex JOIN operations and dynamic aggregations, such as linking a donor's ZIP code to their employer, applying an industry Catcode, and summing the contributions to a specific candidate. However, because D1 billing scales with the number of rows read, it must be shielded from redundant queries.  
Cloudflare KV (Key-Value) storage acts as the primary defense mechanism against runaway D1 costs. KV provides globally distributed, eventually consistent storage with sub-millisecond read latency when data is cached at the local edge node. The system utilizes KV to store the results of computationally expensive tasks. For example, once the D1 database computes the "Top 10 Donor Industries" for a representative, the resulting JSON array is serialized and stored in KV with a key like rep\_summary:H4MN06087:2026. Subsequent requests for that representative read directly from KV, bypassing D1 entirely and reducing database load by orders of magnitude.  
Cloudflare R2 functions as the system's blob storage layer. Beyond archiving the raw FEC bulk files, R2 is critical for the geospatial visualization pipeline. Because serving massive Census TIGER/Line shapefiles dynamically would overwhelm edge workers, the geometry files are pre-processed into optimized Mapbox Vector Tiles (.mbtiles) and served directly from R2 as static assets.

### **Performance & Query Optimization**

Executing complex analytics on a serverless SQLite instance demands rigorous query optimization. The primary metric of concern is rows\_read; a poorly constructed query that triggers a full table scan across millions of records will drastically inflate billing and degrade latency.  
The architectural standard dictates that all queries must utilize covering indexes. When a query filters by committee\_id and sorts by amount, an index must exist containing both columns in the correct sequence, allowing the SQLite engine to satisfy the query entirely from the index B-tree. During deployment, automated CI/CD pipelines will execute EXPLAIN QUERY PLAN against all parameterized statements. If the query planner returns a SCAN operation (indicating a full table read) rather than SEARCH ... USING COVERING INDEX, the build is failed and blocked from reaching production.  
Furthermore, to prevent the real-time execution of expensive window functions (such as ROW\_NUMBER() or RANK()) on massive datasets, the ingestion workflow will pre-calculate rankings and write the results to materialized summary tables (e.g., campaign\_analytics\_summary). Running PRAGMA optimize periodically ensures that the SQLite internal statistics table (sqlite\_stat1) remains accurate, preventing the query planner from selecting suboptimal execution paths due to stale index data.

## **3\. UI/UX & Interactive Design System**

The frontend architecture, hosted on Netlify, adapts the high-density data dashboard aesthetics established in the "Follow the PPP" project. The design system emphasizes clarity, utilizing stark typography and strategic whitespace to make dense financial data legible. Built upon a modern component framework (React or Svelte), the UI is engineered to handle dynamic, client-side rendering of complex datasets.

### **Component Hierarchy and Search Experience**

The user experience centers around an intuitive, friction-free discovery phase. The landing page is dominated by a single, prominent input component designed to accept either a full street address or a ZIP code.  
When the user submits an address, the SearchController component dispatches a request to the Cloudflare Worker API. While the backend performs the cascading geocoding resolution—querying the Census API, verifying TIGER/Line boundaries, and fetching the D1 summary—the frontend mounts a series of skeleton loaders. This immediate visual feedback preserves perceived performance. Once the JSON payload is returned, the DashboardLayout component mounts, injecting the data into its child visualization components.

| Component Name | Role within the Architecture | Data Dependency |
| :---- | :---- | :---- |
| App | Root component; manages global state, routing, and theme providers. | None (Static) |
| SearchController | Handles user input, validation, and dispatches API calls to the geocoding endpoint. | None (Client-side) |
| DashboardLayout | Container for the representative profile; manages the grid layout and responsive breakpoints. | Resolved bioguide\_id |
| SummaryCards | Displays top-line figures: Total Raised, Cash on Hand, and Small-Dollar percentages. | /totals/ JSON payload |
| GeospatialMap | Renders the Mapbox GL JS instance, overlaying the district polygon and donor heatmaps. | Cloudflare R2 .mbtiles |
| MoneyFlowSankey | Renders the D3.js flow diagram illustrating capital origins and intermediary conduits. | D1 Aggregated PAC data |
| IndustryBarChart | Displays the Chart.js categorical breakdown of donors by OpenSecrets Catcodes. | D1 Industry Summaries |

### **Advanced Visualizations**

Rendering geospatial boundaries and financial flows requires specialized client-side libraries carefully orchestrated to prevent main-thread blocking.  
For the interactive map, the platform integrates Mapbox GL JS. Attempting to render raw GeoJSON files of congressional districts—which contain millions of highly precise vertex coordinates—will exhaust browser memory and cause severe stuttering. The architecture mitigates this by utilizing the geojson-vt library to slice the GeoJSON data into optimized vector tiles on the fly, simplifying geometries based on the user's current zoom level. For the heaviest datasets, processing is moved server-side; Tippecanoe is used to generate static Mapbox Vector Tiles (.mbtiles) which are hosted on Cloudflare R2 and streamed to the client, ensuring silky-smooth 60fps panning and zooming.  
To visualize the complex movement of money, the platform utilizes D3.js to construct Sankey diagrams. These flow charts trace capital from specific geographic regions or industry sectors, through major fundraising conduits (such as ActBlue or WinRed), and finally into the candidate's principal campaign committee. This visual metaphor is vital for demonstrating how out-of-state money permeates local elections.  
Categorical breakdowns are handled via Chart.js or Recharts, providing responsive bar and donut charts. These charts clearly delineate the ratio of in-state versus out-of-state contributions, the proportion of small-dollar grassroots donors (under $200) versus large-dollar institutional donors, and the top donor industry sectors based on OpenSecrets categorization.

## **4\. Feature Specifications**

The application architecture supports three primary analytical features, empowering users to interrogate campaign finance data from multiple investigative angles.

### **"Who Funds My Rep?" (Representative Profile)**

The core feature of the platform acts as a comprehensive financial dossier for any Member of Congress. Upon resolving the user's district, the system queries the ccl\_linkage table to identify every political committee authorized by or affiliated with the candidate. This is crucial, as politicians rarely rely solely on a single "Principal Campaign Committee"; they frequently operate Leadership PACs and Joint Fundraising Committees.  
The dashboard aggregates data across all linked committees to present a unified view of the candidate's war chest. It pulls high-level figures from the FEC /totals/ endpoint and itemizes the top contributing organizations. By passing employer strings through the OpenSecrets Catcode mapping, the UI categorizes seemingly disparate corporate PACs into readable industry sectors, revealing systemic dependencies on specific economic interests. Furthermore, a real-time feed pulls Schedule E (Independent Expenditure) notices, alerting users when outside Super PACs suddenly inject dark money into the race via attack ads or mailers.

### **"District Money Footprint" (Reverse Search)**

This feature reverses the traditional analytical paradigm; rather than analyzing the recipient, it analyzes the origin of capital. Users input their ZIP code to discover the political export economy of their neighborhood.  
The backend performs a highly optimized query against the indiv\_contributions table, filtering explicitly by the donor\_zip5 and donor\_zip4 columns. The query joins the recipient committees against the ccl\_linkage table and ultimately the candidates table. The frontend then visualizes this data on a national map, drawing outbound vectors from the user's district to battleground states across the country. This reveals whether a local community is heavily subsidizing out-of-state senatorial campaigns or focusing its financial power domestically.

### **Comparison Mode**

To facilitate informed voting decisions, the Comparison Mode allows users to load two competing candidates side-by-side. The UI aligns identical metrics—total raised, burn rate (disbursements divided by receipts), small-dollar percentages, and top industries—allowing for rapid visual comparison. This feature is particularly effective at exposing disparities between an incumbent heavily funded by corporate PACs and a challenger relying on grassroots individual contributions.

## **5\. Legal & Data Integrity Considerations**

The manipulation and display of federal campaign finance data is fraught with legal pitfalls and profound data integrity challenges. The platform's architecture includes robust safeguards to ensure compliance with federal law and mathematical accuracy.

### **FEC Legal Disclaimers and the "Sale or Use" Ban**

The Federal Election Campaign Act (52 U.S.C. § 30111(a)(4)) strictly prohibits the sale or use of contributor information copied from FEC reports for commercial purposes or for soliciting contributions. The legislative intent is to protect private citizens who participate in the democratic process from being bombarded by commercial solicitations or aggressive political prospecting.  
To ensure strict legal compliance, the platform architecture mandates the injection of prominent legal disclaimers. The frontend will explicitly state that all data is provided solely for civic transparency, educational, and journalistic purposes. Any view that exposes individual itemized donor names will feature a persistent, non-dismissible banner warning users of the statutory prohibition against utilizing the data for solicitation. The platform's Terms of Service will require explicit user agreement to these restrictions, legally indemnifying the platform's operators against third-party misuse.

### **The Double-Counting Paradox & Data Hygiene**

Calculating the true sum of a candidate's fundraising is deceptively difficult. Without rigorous data sanitization, the raw FEC bulk files will cause the platform to wildly overstate financial totals due to various structural duplication mechanics. The D1 query logic implements algorithmic filters to resolve three primary forms of double-counting:  
First, the architecture addresses the **Conduit / Earmark Problem**. When a citizen donates via a digital conduit like ActBlue or WinRed, the transaction exists twice in the FEC database. It is reported by the conduit as an "earmarked contribution passed through" (Transaction Type 24T), and it is reported simultaneously by the receiving candidate's committee as an "earmarked contribution received" (Transaction Type 15E). Summing both records artificially doubles the impact of grassroots donors. The platform's aggregation queries explicitly exclude all transaction\_tp \= '24T' records from candidate totals.  
Second, the system must navigate **Amendment Collisions**. Committees routinely file amended financial reports to correct errors. The FEC bulk files retain both the original record (Amendment Indicator N) and the newly amended record (A). A naive deletion of all N records is catastrophic, as different reports (e.g., Q1 and Q3) may share the same election cycle. The ingestion pipeline groups records by committee\_id, report\_type, and report\_year, carefully superseding original entries only when an amendment exists for that exact filing period.  
Third, the platform accounts for **Itemized Sub-Transactions**. Frequently, a large PAC transfer is accompanied by memo lines detailing the constituent donors who funded that specific transfer. These sub-transactions are flagged in the database with memo\_cd \= 'X'. If a query sums the total transfer amount alongside its memo sub-lines, the money is counted twice. All D1 summation queries apply a strict memo\_cd IS NULL OR memo\_cd \!= 'X' filter.

### **Data Freshness & Entity Resolution**

The latency of campaign finance data is dictated by federal reporting schedules. Depending on the committee type and the proximity to an election, filers may submit data monthly or quarterly. Consequently, a candidate's financial profile may be up to 90 days out of date during off-peak periods. The user interface handles this discrepancy by explicitly rendering the "Data Current As Of" timestamp and clearly defining the active election cycle.  
Finally, resolving corporate entities poses a massive challenge. Donors self-report their employers, resulting in extreme string fragmentation (e.g., "Google," "Alphabet," "Google LLC," "Google Inc."). To accurately aggregate top employers, the architecture requires an Entity Resolution (ER) pipeline. The system will leverage probabilistic record linkage techniques—historically based on the Fellegi-Sunter model, which assigns mathematical weights to string similarities. More advanced implementations utilize pre-trained Large Language Model (LLM) embeddings (such as the EnsembleLink methodology) to perform zero-shot semantic matching. This ER pipeline operates asynchronously, generating a clean mapping table that translates fragmented employer strings into unified corporate entities before the data is queried in D1.

## **6\. Step-by-Step Implementation Roadmap**

The deployment of this architecture will follow a phased, iterative approach, ensuring that foundational data integrity is established before introducing complex front-end visual mapping.  
**Phase 1: MVP Geocoding & Basic FEC Integration** The initial phase focuses on establishing the core routing and lookup mechanics. The Netlify frontend is initialized, and the primary search interface is constructed. The backend integrates the U.S. Census Geocoding API to translate user input into Congressional District FIPS codes. Concurrently, Cloudflare Workers are configured to securely proxy requests to the OpenFEC REST API (/v1/candidates/search/ and /v1/totals/), allowing the UI to render a basic, real-time candidate profile without requiring local database infrastructure.  
**Phase 2: Edge Database Sync & Caching Layer** This phase transitions the platform from relying on live API calls to utilizing a robust edge database. The Cloudflare D1 instance is provisioned, and the SQLite schema is defined and migrated using Drizzle ORM (wrangler d1 migrations apply). Cloudflare Workflows are authored to orchestrate the nightly extraction of FEC bulk .zip files from R2, parsing the pipe-delimited data, and executing batched insertions into D1. The KV caching layer is implemented to intercept redundant queries, drastically reducing D1 rows\_read metrics.  
**Phase 3: Interactive Visualizations & Analytics** With the data layer stabilized, the focus shifts to advanced frontend analytics. The TIGER/Line district shapefiles are processed via Tippecanoe into .mbtiles and hosted on R2. Mapbox GL JS and geojson-vt are integrated to render the interactive geospatial heatmaps. D3.js and Chart.js components are developed to visualize the Sankey money flows and categorical industry breakdowns. Crucially, the D1 backend is optimized with covering indexes to support these complex aggregation queries.  
**Phase 4: Production Polish, SEO, and Deployment** The final phase prepares the application for public consumption. Programmatic SEO is implemented to generate static routes for every congressional district, allowing search engines to index the platform effectively. The mandatory FEC "Sale or Use" legal disclaimers are finalized within the UI. A comprehensive audit of D1 query plans is conducted via EXPLAIN QUERY PLAN to eliminate any remaining full table scans. Once performance benchmarks are met, the application undergoes a final production build and is deployed globally via Netlify and Cloudflare.

#### **Works cited**

1\. OpenFEC API Documentation, https://api.open.fec.gov/developers/ 2\. Load Fec Gov data to DuckDB \- dltHub, https://dlthub.com/context/pipeline/fec-gov-to-duckdb 3\. US Political Donation Search \- FEC Campaign Finance \- Apify, https://apify.com/ryanclinton/fec-campaign-finance 4\. OpenFEC API makes new itemized data available, https://sunlightfoundation.com/2015/08/18/openfec-api-makes-new-itemized-data-available/ 5\. Congress.gov API, https://api.congress.gov/ 6\. Glossary \- FollowTheMoney.org, https://www.followthemoney.org/help/glossary/ 7\. TIGER/Line \- Atlas, https://atlas.co/data-sources/tiger-line/ 8\. Docs · GeoPrimitives, https://geoprimitives.dev/docs/ 9\. TIGER/Line Shapefile, 2020, State, North Carolina, NC, 118th, https://catalog.data.gov/dataset/tiger-line-shapefile-2020-state-north-carolina-nc-118th-congressional-district 10\. TIGER/Line Shapefile, 2020, Nation, U.S., 116th Congressional, https://catalog.data.gov/dataset/tiger-line-shapefile-2020-nation-u-s-116th-congressional-districts 11\. TIGER/Line Shapefiles \- U.S. Census Bureau, https://www.census.gov/geographies/mapping-files/2023/geo/tiger-line-file.html 12\. TIGER/Line Geodatabases \- U.S. Census Bureau, https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-geodatabase-file.html 13\. The SQLite Renaissance: Why the World's Most Deployed Database, https://dev.to/pockit\_tools/the-sqlite-renaissance-why-the-worlds-most-deployed-database-is-taking-over-production-in-2026-3jcc 14\. Cloudflare D1: Serverless SQLite at the Edge \- MinhVo | AI Engineer, https://minhvo.is-a.dev/blogs/cloudflare-d1-serverless-sqlite-at-the-edge 15\. Chapter 12: D1: SQLite at the Edge | Architecting on Cloudflare, https://architectingoncloudflare.com/chapter-12 16\. Cloudflare D1: SQLite at the Edge After 6 Months in Production, https://dev.to/whoffagents/cloudflare-d1-sqlite-at-the-edge-after-6-months-in-production-551j 17\. Use indexes · Cloudflare D1 docs, https://developers.cloudflare.com/d1/best-practices/use-indexes/ 18\. How to Optimize D1 Rows Read for Faster Cloudflare Databases, https://www.jeeviacademy.com/blog/d1-rows-read-optimization-the-complete-guide 19\. Cloudflare D1 Row Reads Pricing \- Reddit, https://www.reddit.com/r/CloudFlare/comments/1ncacre/cloudflare\_d1\_row\_reads\_pricing/ 20\. Finding and Analyzing Data on FEC.gov \- Amazon S3, https://s3.amazonaws.com/ire16/campaign-finance/MiningFECData.pdf 21\. Cloudflare Workers | Noise | Page 2, https://noise.getoto.net/tag/cloudflare-workers/page/2/ 22\. Workflows \- Introduction \- Cloudflare Workers SDK, https://cloudflare-workers-sdk.mintlify.app/advanced/workflows 23\. Production at the Edge \- Flavio Copes, https://flaviocopes.com/production-at-the-edge/ 24\. Cloudflare D1/KV/Durable Objects vs DynamoDB vs Cosmos DB vs, https://inventivehq.com/blog/cloudflare-d1-kv-vs-dynamodb-vs-cosmos-db-vs-firestore-edge-databases 25\. (PDF) Estimating Interest Group Ideal Points with Public Position, https://www.researchgate.net/publication/324040699\_Estimating\_Interest\_Group\_Ideal\_Points\_with\_Public\_Position-Taking\_on\_Bills\_in\_Congress 26\. How We Cut Cloudflare D1 Database Reads from 56 Billion to 200K, https://medium.com/@sumitkanoje/how-we-cut-cloudflare-d1-database-reads-from-56-billion-to-200k-and-saved-our-bill-4aaec45ef115 27\. Cloudflare Workers KV vs D1: Complete Performance Guide, https://www.proptechusa.ai/news/cloudflare-workers-kv-vs-d1-performance-comparison 28\. How SonicJS Uses Cloudflare D1 at the Edge | SonicJS Blog, https://sonicjs.com/blog/sonicjs-d1-database-deep-dive 29\. I got a $134 Cloudflare D1 bill. Here's how I cut it 95%, https://fullstacksveltekit.com/blog/cloudflare-d1-bill 30\. mapbox-gl-mbtiles CDN by jsDelivr \- A CDN for npm and GitHub, https://www.jsdelivr.com/package/npm/mapbox-gl-mbtiles 31\. How to replace your API with vector tiles \- Development Seed, https://developmentseed.org/blog/2017-08-09-how-to-replace-your-api-with-vector-tiles/ 32\. Cloudflare D1: Reduce Rows Read & Speed Up Queries, https://www.jeeviacademy.com/blog/cloudflare-d1-reduce-rows-read-speed-up-queries-part-1 33\. Read EXPLAIN QUERY PLAN — SQLite Course \- Flavio Copes, https://flaviocopes.com/courses/sqlite/explain-query-plan/ 34\. SQL Window Functions: Ranking, Running Totals, and Analytics, https://www.dbgate.io/news/2026-03-24-sql-window-functions-tutorial/ 35\. Release notes · Cloudflare D1 docs, https://developers.cloudflare.com/d1/platform/release-notes/ 36\. geojson-vt/README.md at main \- GitHub, https://github.com/mapbox/geojson-vt/blob/main/README.md 37\. Working with large GeoJSON sources in Mapbox GL JS | Help, https://docs.mapbox.com/help/troubleshooting/working-with-large-geojson-data/ 38\. How to use mapbox vector tiles in a performant way? \- Stack Overflow, https://stackoverflow.com/questions/72559195/how-to-use-mapbox-vector-tiles-in-a-performant-way 39\. Show me the money: Create your own Federal Election App with the, https://medium.com/@tommasina1/show-me-the-money-create-your-own-federal-election-app-with-the-open-fec-api-e183dc266a5b 40\. Follow the Money \- Helyn Research, https://helyn.com/follow-the-money 41\. Joint fundraising with other candidates and political committees \- FEC, https://www.fec.gov/help-candidates-and-committees/joint-fundraising-candidates-political-committees/ 42\. Federal Election Commission (FEC) API Data Retrieval With Python, https://medium.com/@vernal.futures/federal-election-commission-fec-api-data-retrieval-with-python-and-power-bi-dashboard-4469016059d1 43\. Openfec — agent-native CLI, skill and MCP server \- Printing Press, https://printingpress.dev/library/other/fec 44\. Making independent expenditures \- FEC, https://www.fec.gov/help-candidates-and-committees/making-independent-expenditures/ 45\. Super PAC Reporting & Compliance Software | ISPolitical, https://ispolitical.com/super-pac-reporting/ 46\. Understanding independent expenditures \- FEC, https://www.fec.gov/help-candidates-and-committees/candidate-taking-receipts/understanding-independent-expenditures/ 47\. The Flow of Money in Federal Elections \- Brookings Institution, https://www.brookings.edu/wp-content/uploads/2016/06/20021201\_paper.pdf 48\. Campaign Guide for Political Party Committees (February 2024\) \- FEC, https://www.fec.gov/resources/cms-content/documents/policy-guidance/partygui.pdf 49\. FED. ELEC. COM'N v. POL. CONTRIB. DATA, (S.D.N.Y. ... \- CaseMine, https://www.casemine.com/judgement/in/5914bfecadd7b049347b0c07 50\. SCHEDULE B (FEC Form 3X) ITEMIZED DISBURSEMENTS, https://docquery.fec.gov/pdf/040/202601149793972040/202601149793972040\_000014.pdf 51\. Transaction type code descriptions \- FEC, https://www.fec.gov/campaign-finance-data/transaction-type-code-descriptions/ 52\. Any transaction from one committee to another file description \- FEC, https://www.fec.gov/campaign-finance-data/any-transaction-one-committee-another-file-description/ 53\. When Are the FEC Filing Deadlines? \- ISPolitical, https://ispolitical.com/blog/compliance/when-are-the-fec-filing-deadlines/ 54\. 2026 FEC Filing Deadlines \- CMDI, https://www.cmdi.com/blog/2026-fec-filing-deadlines 55\. Reports due in 2026 \- FEC, https://www.fec.gov/updates/reports-due-in-2026/ 56\. Using a Probabilistic Model to Assist Merging of Large-Scale, https://www.researchgate.net/publication/330092176\_Using\_a\_Probabilistic\_Model\_to\_Assist\_Merging\_of\_Large-Scale\_Administrative\_Records 57\. The Fellegi-Sunter Model \- Splink, https://moj-analytical-services.github.io/splink/topic\_guides/theory/fellegi\_sunter.html 58\. An Introduction to Probabilistic Record Linkage with a ... \- CDC Stacks, https://stacks.cdc.gov/view/cdc/224735/cdc\_224735\_DS1.pdf 59\. EnsembleLink: Accurate Record Linkage Without Training Data \- arXiv, https://arxiv.org/abs/2601.21138 60\. A Survey of Indexing Techniques for Scalable Record Linkage and, https://www.researchgate.net/publication/228787127\_A\_Survey\_of\_Indexing\_Techniques\_for\_Scalable\_Record\_Linkage\_and\_Deduplication 61\. Migrations · Cloudflare D1 docs, https://developers.cloudflare.com/d1/reference/migrations/ 62\. Setting up D1 Database with Drizzle in a Hono Cloudflare Worker App, https://firdausng.com/posts/setup-d1-cloudflare-worker-with-drizzle