# Connected in Climate — Engineering Design Doc

Mentor/mentee matchmaking platform for climate tech · v2 — all open questions resolved

## Contents

1. [Problem & Solution Overview](#1-problem--solution-overview)
2. [System Architecture](#2-system-architecture)
3. [Matching Algorithm](#3-matching-algorithm)
4. [Data Model](#4-data-model)
5. [API Surface](#5-api-surface)
6. [UI Views & Flows](#6-ui-views--flows)
7. [Admin System](#7-admin-system)
8. [Implementation Milestones](#8-implementation-milestones)
9. [Worked Examples](#9-worked-examples)
10. [Resolved Decisions Log](#10-resolved-decisions-log)

---

## 1. Problem & Solution Overview

### The Problem

Climate tech hiring uniquely requires both **horizontal capabilities** (software engineering, corporate finance, strategy) and **vertical domain knowledge** (grid mechanics, carbon accounting, climate policy). Generic job boards and ATS systems can't evaluate this dual-axis fit. On the mentorship side, mentees flood platforms with unstructured requests and get ghosted; mentors experience decision fatigue from generic solicitations.

### The Solution

Connected in Climate is a **high-precision curation engine** that matches mentors and mentees using a hybrid scoring algorithm combining structured categorical overlap, topic priority alignment, and semantic vector embeddings. It is _not_ a messaging platform or job board — it produces a match with a direct path to scheduling.

### Three Product Modules

| Module | Description | Scope |
|--------|-------------|-------|
| **1. AI Application Gateway** | Screens statements of intent for authenticity, domain focus, and goal clarity before matching. LLM-based evaluation with inline coaching for low-quality submissions. | Out of Scope |
| **2. Weighted Dual-Axis Matching Engine** | Pairs mentors/mentees via user-weighted horizontal, vertical, & sector categories, topic priorities, and semantic embeddings. Delivers direct calendar booking links upon pairing. | P1 |
| **3. Decoupled Quality Evaluation** | Collects post-match feedback asynchronously. Free-form input, optionally structured over time. Background LLM analysis of feedback for quality scoring. | P1 (feedback form), Out of Scope (LLM analysis) |

---

## 2. System Architecture

### Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React (Vite) | Existing scaffold in `client/` |
| API | Express.js (Node 20+) | Existing scaffold in `server/` |
| Database | PostgreSQL 16 + pgvector | pgvector extension needed for semantic embeddings |
| Embeddings | OpenAI `text-embedding-3-small` | 1536-dimension vectors |
| Deploy | DigitalOcean App Platform | Existing deploy pipeline via GitHub Actions |

### High-Level Match Flow

```
Mentee confirms profile
        ↓
POST /api/matches/start
        ↓
Phase 1: Eligibility filter
        ↓
Phase 2: Categorical scoring → Phase 3: Topic scoring → Phase 4: Semantic scoring
        ↓
Phase 5: Final synthesis + ranking
        ↓
All scored mentors stored · Top 1 shown to user
        ↓ no eligible mentors?
Result page: "You matched with X!" | "No mentors available"
```

### Data Ingestion

> **Resolved: Manual import from existing data source**
> Participant data already exists externally (spreadsheet/Airtable). Build a one-time import script (CSV/JSON → Postgres) that an admin runs manually. No ongoing sync needed. Embeddings are computed during import. Future cohorts re-run the same script with new data.

Profiles are stored in Postgres with a **hybrid column strategy**:

- **Stable columns** (queried, never expected to change shape): `email`, `name`, `role`
- **Dynamic JSON payload** (may evolve between cohorts): career areas, climate areas, sectors, topics, weights, statement of intent, max_capacity, etc.

This lets us add/rename profile fields without schema migrations — only the import script and matching algorithm need updating.

---

## 3. Matching Algorithm

For a given mentee **E**, the algorithm scores every eligible mentor **M** and returns results ranked by Final Score. The architecture is split into two stages: **eligibility filtering** (Phase 1) and **scoring** (Phases 2–5). This decoupling means the scoring algorithm is a pure function of two profiles — all business-logic filtering happens before and after it.

### Phase 1: Eligibility Filter (Pre-Scoring)

Hard constraints that eliminate mentors before any scoring. All must pass:

| Constraint | Rule | Source |
|-----------|------|--------|
| Self-match | `E.email != M.email` | Profile key |
| Capacity | `ActiveMatchCount(M) < MaxCapacity(M)` | `matches` (ACTIVE) + `user_profiles.payload.max_capacity` |
| Active duplicate | No ACTIVE match exists between E and M | `matches` table (status = ACTIVE only) |
| Block list | `IsBlocked(E, M) == false` | `rejections` table |

> **Resolved: Previously rejected matches do NOT block re-matching.**
> Only ACTIVE matches and explicit block-list entries prevent pairing. A previously rejected match means the pair _can_ be scored again (the rejection cleared the slot). If an admin wants to permanently prevent a pair, they use the block list. The computation payload records any prior match history for this pair (see Phase 5) for audit transparency.

### Phase 2: Dual-Axis Categorical Scoring

Evaluates overlap across multi-select arrays using weighted Jaccard-style similarity. Users assign importance weights `W` from 1–5 to each axis: horizontal, vertical, _and_ sector.

```
C_horizontal = |Intersection(E.career_areas, M.career_areas)| / |E.career_areas|
C_vertical   = |Intersection(E.climate_areas, M.climate_areas)| / |E.climate_areas|
C_sector     = |Intersection(E.sectors, M.sectors)| / |E.sectors|

Categorical_Score = (W_horiz × C_horizontal + W_vert × C_vertical + W_sector × C_sector)
                  / (W_horiz + W_vert + W_sector)
```

**Key details:**
- Intersection / _mentee_ total (not union) — measures how well the mentor covers what the mentee needs.
- All three weights (`W_horiz`, `W_vert`, `W_sector`) are user-configurable, each 1–5.
- Sectors: Private, Nonprofit, Government, Project-based.
- Result range: `[0.0, 1.0]`.

### Phase 3: Priority Topic Alignment

Mentees rank up to N priority topics (`T1 .. TN`). Mentors designate up to M top strengths and additional general topics. Neither N nor M is hardcoded — the formula adapts to however many the user provides. Scoring uses rank-discounted weighting:

```
Score(Tk, M) = 1.0  if Tk ∈ M.top_strengths
             = 0.6  if Tk ∈ M.general_topics
             = 0.0  otherwise

Raw = Σ(k=1..N) Score(Tk, M) / k

Topic_Score = Raw / H(N)      where H(N) = Σ(k=1..N) 1/k  (Nth harmonic number)
```

**Normalization:** `H(N)` is the theoretical maximum (all topics match top strengths). Examples: H(3) = 1.833, H(5) = 2.283. This normalizes to `[0.0, 1.0]` regardless of how many topics the mentee selects.

### Phase 4: Semantic Embedding Similarity

Captures nuanced alignment (career transition philosophy, specific technology focus) that rigid forms miss.

- **Mentee input:** Statement of Intent (free-text, <200 words)
- **Mentor input:** Greatest Strength / Motivation (free-text)
- **Model:** OpenAI `text-embedding-3-small` → 1536-dim vectors
- **Storage:** `VECTOR(1536)` column on `user_profiles` via pgvector
- **Metric:** Cosine similarity → `Semantic_Score ∈ [-1.0, 1.0]` (in practice 0.0–1.0 for natural text)

```
Semantic_Score = cosine_similarity(embed(E.statement_of_intent), embed(M.motivation))
```

Embeddings are computed during profile import and stored. No real-time OpenAI calls during matching.

### Phase 4b: Geographic Proximity (Optional)

When a mentee sets `geo_match_preference: true`, geographic proximity becomes a scoring factor. When it's off, this phase is skipped entirely and the non-geo weights apply.

```
// P1: String-based location matching (designed for easy swap to geocoding)
Geo_Score = computeGeoScore(E, M)
          = 1.0   if E.location == M.location  (exact city match)
          = 0.5   if sameRegion(E.location, M.location)
          = 0.25  if "Remote" ∈ M.locations_open_to
          = 0.0   otherwise
```

> **Future: geocoding upgrade.** Replace `computeGeoScore()` internals with haversine distance using lat/lng from a geocoding API (e.g., OpenStreetMap Nominatim, free). Score based on `geo_match_distance_km`. The function signature and the rest of the algorithm stay unchanged.

### Phase 5: Final Score Synthesis & Ranking

The final score blends all components. Weights shift depending on whether the mentee opted into geographic matching:

| Component | Weight (no geo) | Weight (geo enabled) | Rationale |
|-----------|----------------|---------------------|-----------|
| Categorical Score | 0.45 | 0.40 | Structural fit is the strongest signal |
| Topic Score | 0.35 | 0.30 | Priority alignment drives conversation quality |
| Semantic Score | 0.20 | 0.15 | Captures nuance but noisier than structured data |
| Geo Score | — | 0.15 | Proximity when user requests it |

```
// When geo_match_preference is OFF:
Final_Score = Reliability × (0.45 × Categorical + 0.35 × Topic + 0.20 × Semantic)

// When geo_match_preference is ON:
Final_Score = Reliability × (0.40 × Categorical + 0.30 × Topic + 0.15 × Semantic + 0.15 × Geo)
```

**Reliability Multiplier:** `[0.8, 1.0]` — derived from Module 3 feedback history. **Defaults to `1.0` for P1** since LLM feedback analysis is out of scope.

### Output & Storage

All scored mentors are ranked by `Final_Score` descending. **All results** are stored in the `matches` table (no limit — easy to change later). Only the **top 1 result** is shown to the mentee on the result page.

Each stored match includes a **computation payload** that snapshots:

- **Profile inputs at match time** — full copies of both E and M profiles (payload fields + stable fields) as they existed when the algorithm ran, so the match is fully reproducible even if profiles later change.
- **Phase-by-phase scores** — categorical breakdown (each C_* and W_*), topic breakdown (each T_k score), semantic score, and final weighted synthesis.
- **Prior match history** — list of any previous match IDs between this pair, with their statuses and timestamps, for audit transparency.
- **Code commit** — git SHA of the algorithm version that produced this match.

<details>
<summary>Example computation_payload structure</summary>

```json
{
  "algorithm_version": "abc123f",
  "mentee_snapshot": {
    "email": "jane@example.com",
    "name": "Jane Doe",
    "role": "mentee",
    "career_areas": ["Engineering", "IT"],
    "climate_areas": ["Energy", "Transportation"],
    "sectors": ["Private"],
    "top_topics": ["Translating non-climate experience", "..."],
    "statement_of_intent": "6 years building...",
    "location": "San Francisco, CA",
    "geo_match_preference": true,
    "w_horiz": 5, "w_vert": 1, "w_sector": 2
  },
  "mentor_snapshot": {
    "email": "mentor@example.com",
    "name": "Alex Smith",
    "role": "mentor",
    "career_areas": ["Engineering", "Operations", "Strategy"],
    "climate_areas": ["Energy", "Built Environment"],
    "sectors": ["Private"],
    "top_strengths": ["Translating non-climate experience", "..."],
    "general_topics": ["Job search strategy"],
    "motivation": "Helped 20+ engineers...",
    "location": "San Francisco, CA",
    "max_capacity": 2
  },
  "scores": {
    "categorical": {
      "c_horizontal": 0.50, "w_horiz": 5,
      "c_vertical": 0.50, "w_vert": 1,
      "c_sector": 1.00, "w_sector": 2,
      "combined": 0.625
    },
    "topic": {
      "details": [
        { "topic": "Translating...", "match_type": "top_strength", "raw": 1.0, "discounted": 1.0 },
        { "topic": "Job search...", "match_type": "general", "raw": 0.6, "discounted": 0.3 },
        { "topic": "Networking", "match_type": "top_strength", "raw": 1.0, "discounted": 0.333 }
      ],
      "harmonic_n": 1.833,
      "combined": 0.891
    },
    "semantic": 0.865,
    "geo": { "score": 1.0, "reason": "exact_city_match", "enabled": true },
    "reliability_multiplier": 1.0,
    "weights_used": { "categorical": 0.40, "topic": 0.30, "semantic": 0.15, "geo": 0.15 },
    "final": 0.738
  },
  "prior_matches": [
    { "match_id": "...", "status": "REJECTED", "created_at": "...", "reason": "domain mismatch" }
  ]
}
```
</details>

### Immutability Principle

**Active matches never change if the underlying profile changes.** A match is a computation set in stone at the time it was made. If a user updates their profile, only future match runs are affected. The profile snapshots in the computation payload preserve exactly what inputs produced the score.

### No-Match Case

If no mentors pass Phase 1, the result page shows **"No mentors available right now"** instead of a match card. No match record is created. The mentee's dashboard (a separate page) continues to show their existing active matches, which may be empty.

---

## 4. Data Model

### Entity Relationship

```
user_profiles 1──< matches >──1 user_profiles
                     │
                     ├──< match_actions
                     ├──< feedbacks
                     └──< rejections
```

### Column Strategy

Every table uses a **hybrid approach**: fields that are stable and needed for queries are standalone Postgres columns; fields that may evolve across cohorts live in a `JSONB payload` column. This avoids schema migrations when product requirements shift.

### Tables

#### `user_profiles`

| Column | Type | Stable / Dynamic | Notes |
|--------|------|------------------|-------|
| `email` | `TEXT PRIMARY KEY` | Stable | Unique key, serves as username in P1 |
| `name` | `TEXT NOT NULL` | Stable | |
| `role` | `TEXT NOT NULL` | Stable | `'mentor'`, `'mentee'`, or `'both'` |
| `payload` | `JSONB NOT NULL` | Dynamic | All profile details that may evolve |
| `embedding` | `VECTOR(1536)` | Stable | pgvector — computed during import |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | Stable | |
| `updated_at` | `TIMESTAMPTZ DEFAULT now()` | Stable | |

<details>
<summary>Mentor payload example</summary>

```json
{
  "preferred_name": "Alex",
  "name_pronunciation": "Ah-lex Chen",
  "pronouns": "he/him",
  "photo_url": "https://example.com/photos/alex.jpg",
  "career_level": "Senior",
  "certifications": ["PMP"],
  "interests_hobbies": ["Rock climbing", "Solarpunk fiction"],
  "fun_fact": "Built a DIY home battery from recycled EV cells",
  "links": { "linkedin": "https://...", "phone": "+1-555-0101", "calendly": "https://..." },

  "location": "San Francisco, CA",
  "locations_open_to": ["San Francisco, CA", "Remote"],
  "geo_match_preference": true,
  "geo_match_distance_km": 80,

  "career_areas": ["Engineering", "Operations", "Strategy"],
  "climate_areas": ["Energy", "Built Environment"],
  "sectors": ["Private"],
  "top_strengths": ["Translating non-climate experience", "Developing leadership",
                     "Networking", "VPP architecture", "Team building"],
  "general_topics": ["Job search strategy", "Interview prep"],
  "motivation": "Helped 20+ engineers transition into climate tech...",
  "max_capacity": 2
}
```
</details>

<details>
<summary>Mentee payload example</summary>

```json
{
  "preferred_name": "Jane",
  "pronouns": "she/her",
  "career_level": "Mid-Level",
  "fun_fact": "Once deployed code from the summit of Mt. Rainier",
  "links": { "linkedin": "https://...", "phone": "+1-555-0201" },

  "location": "San Francisco, CA",
  "locations_open_to": ["San Francisco, CA", "Remote"],
  "geo_match_preference": true,
  "geo_match_distance_km": 80,

  "career_areas": ["Engineering", "IT"],
  "climate_areas": ["Energy", "Transportation"],
  "sectors": ["Private"],
  "top_topics": ["Translating non-climate experience", "Job search strategy", "Networking"],
  "statement_of_intent": "6 years building high-throughput distributed...",
  "w_horiz": 5,
  "w_vert": 1,
  "w_sector": 2
}
```
</details>

#### `matches`

| Column | Type | Notes |
|--------|------|-------|
| `match_id` | `UUID PRIMARY KEY` | UUIDv7 (timestamp-sortable) |
| `mentor_email` | `TEXT REFERENCES user_profiles` | |
| `mentee_email` | `TEXT REFERENCES user_profiles` | |
| `status` | `TEXT NOT NULL DEFAULT 'ACTIVE'` | `ACTIVE` \| `REJECTED` \| `FINISHED` |
| `final_score` | `NUMERIC(5,4)` | Denormalized for quick sorting/queries |
| `rank` | `INTEGER NOT NULL` | 1 = top match (shown to user), 2+ = stored for admin |
| `computation_payload` | `JSONB NOT NULL` | Full algorithm breakdown including profile snapshots and prior match history |
| `code_commit` | `TEXT NOT NULL` | Git SHA at match time |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | |

**Match lifecycle:**
- **ACTIVE** — Visible to both parties. Signals an ongoing mentorship. Only rank=1 matches start as ACTIVE; lower-ranked results are stored for admin reference only.
- **REJECTED** — Terminal. Admin (or possibly user) rejects with a reason. Does _not_ automatically add to block list (admin chooses whether to also block the pair).
- **FINISHED** — Terminal. Mentorship concluded naturally. No current use case but needed for future.

**Code commit tracking:**
- **DigitalOcean App Platform:** Provides `COMMIT_HASH` as a built-in runtime env var. No config needed.
- **Local dev:** Read from `git rev-parse HEAD` at server startup, cached in memory. Fallback: `"local-dev"` if not in a git repo.

#### `match_actions`

| Column | Type | Notes |
|--------|------|-------|
| `action_id` | `UUID PRIMARY KEY` | UUIDv7 |
| `match_id` | `UUID REFERENCES matches` | |
| `actor_email` | `TEXT` | Who performed the action |
| `action_type` | `TEXT NOT NULL` | `VIEW` \| `FEEDBACK` \| `CONTACT_CLICK` \| `REJECT` |
| `payload` | `JSONB` | Action-specific data |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | |

#### `feedbacks`

| Column | Type | Notes |
|--------|------|-------|
| `feedback_id` | `UUID PRIMARY KEY` | UUIDv7 — multiple feedbacks per match allowed |
| `match_id` | `UUID REFERENCES matches` | |
| `submitter_email` | `TEXT NOT NULL` | The mentor or mentee who submitted |
| `rating` | `SMALLINT` | Optional structured rating (future) |
| `text` | `TEXT NOT NULL` | Free-form feedback |
| `payload` | `JSONB` | Additional structured fields as they evolve |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | |

#### `rejections`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID PRIMARY KEY` | |
| `mentor_email` | `TEXT NOT NULL` | |
| `mentee_email` | `TEXT NOT NULL` | |
| `match_id` | `UUID REFERENCES matches` | Nullable — can be a manual block without a prior match |
| `reason` | `TEXT` | |
| `created_by` | `TEXT NOT NULL` | Admin who created the block |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | |

This is a **block list**, not a rejection log. A row means this pair should never be matched. Rejecting a match does _not_ automatically create a row here — the admin explicitly decides whether to also block the pair. Admins can also add blocks without a prior match (e.g., conflict of interest).

---

## 5. API Surface

### P1 Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/profiles/:email` | Get user profile |
| `PUT` | `/api/profiles/:email` | Upsert profile (triggers embedding recompute for future matches) |
| `POST` | `/api/matches/start` | Run matching for a mentee. Body: `{ email }`. Returns top match or "no mentors available". |
| `GET` | `/api/matches?email=...&role=...` | List ACTIVE rank=1 matches for a user |
| `GET` | `/api/matches/:match_id` | Match detail (user view: matched person's profile, no computation payload) |
| `POST` | `/api/matches/:match_id/actions` | Log an action (VIEW, CONTACT_CLICK) |
| `POST` | `/api/matches/:match_id/feedback` | Submit feedback |
| `GET` | `/api/admin/matches?email=...` | Admin: all matches (all ranks) with computation payloads |
| `POST` | `/api/admin/matches/:match_id/reject` | Admin: reject a match. Optional: `{ also_block: true }` |
| `GET` | `/api/admin/feedback?email=...` | Admin: view feedback |
| `GET` | `/api/admin/rejections` | Admin: list block list |
| `POST` | `/api/admin/rejections` | Admin: add manual block |
| `DELETE` | `/api/admin/rejections/:id` | Admin: remove a block |

### Authentication

**P1:** Email-based access (enter email to view as that user). No login required. Acceptable for a closed pilot with known participants.

**P1 stretch:** Magic-link email authentication — user requests a link, clicks a time-limited token sent to their email, gets a session.

**P2:** Full login (OAuth or similar), role assignment.

---

## 6. UI Views & Flows

### Key Distinction: Dashboard vs. Result Page

These are **two separate pages** with different purposes:

- **Dashboard** (`/mentee/:email` or `/mentor/:email`) — Shows existing active matches. Can be empty if no matches yet. Has a "Find a Mentor" button (mentee only).
- **Result page** (shown after clicking "Find a Mentor") — Shows the outcome of a single match run: either "You matched with [person]!" or "No mentors available right now."

### User Flow (Mentee)

1. Enter email on landing page → see mentee dashboard with existing matches
2. Click **"Find a Mentor"** → confirm profile is up to date
3. Algorithm runs → result page: "You matched with [mentor]!" or "No mentors available"
4. From dashboard, view any active match: mentor profile, contact links (email, calendar)
5. Submit feedback on any match at any time

### User Flow (Mentor)

1. Enter email on landing page → see mentor dashboard with active mentees
2. View match details for any mentee
3. Submit feedback on any match at any time

### Pages

| Page | Route | Priority |
|------|-------|----------|
| Landing / email entry | `/` | P1 |
| Mentee dashboard | `/mentee/:email` | P1 |
| Mentor dashboard | `/mentor/:email` | P1 |
| Match result (post-algorithm) | `/matches/result/:run_id` | P1 |
| Match detail | `/matches/:match_id` | P1 |
| Feedback form | `/matches/:match_id/feedback` | P1 |
| Admin panel | `/admin` | P1 |
| Login | `/login` | P2 |

### Emails

Any email sent by the platform includes a button linking the user back to their match page. This drives the VIEW metric and encourages feedback.

---

## 7. Admin System

### Roles

| Role | Permissions |
|------|------------|
| **Regular User** | View own profile, matches (rank=1 only), submit feedback |
| **Admin** | View all matches (all ranks) & computation payloads for any email. View all feedback. Reject matches (+optional block). Manage block list. Granted to Connected In Climate members. |
| **Super Admin** | All admin permissions + grant/revoke admin access to other users |

**P1 implementation:** Admin pages are separate routes. Admin list is stored in config (env var or a simple config table). Proper role assignment via user login is P2.

---

## 8. Implementation Milestones

### P1 — Pilot Launch

Everything needed to run the first cohort of mentor/mentee matches.

1. **Data import script** — CSV/JSON → Postgres import. Computes embeddings via OpenAI on ingest. Manually run by admin per cohort.
2. **Database schema** — All 5 tables with pgvector extension. Migration script.
3. **Matching algorithm** — All 5 phases. Unit tests for each phase. Integration tests using the two worked examples.
4. **Email-based user views** — Landing page with email entry. Mentee dashboard with "Find a Mentor" button. Mentor dashboard with mentee list.
5. **Match result page** — "You matched with X!" or "No mentors available." Separate from dashboard.
6. **Match detail page** — Matched person's profile and contact links.
7. **Feedback system** — Free-form feedback form accessible from match page. Feedback storage.
8. **Admin panel** — Search by email, view all matches with computation payloads, reject matches (with optional block), manage block list, view feedback.
9. **Action tracking** — Log VIEW, CONTACT_CLICK, and FEEDBACK events in `match_actions`.
10. **Magic-link auth** (stretch) — After all above is working. Time-limited email token for session.

### P2 — Post-Pilot

1. Full user login (OAuth or similar — use existing system, don't reinvent).
2. Role assignment system (Super Admin, Admin, Regular User) in the database.
3. Quick-links to schedule meetings or message via users' preferred platform.

### P3 — Production Scale

1. Payment platform (business model TBD).
2. Incentive models (points system for mentors/mentees).
3. AI evaluation of match quality and feedback (Module 3 LLM analysis → powers Reliability Multiplier).
4. AI Application Gateway (Module 1).

### Out of Scope

- Custom direct messaging (users connect via external platforms).

---

## 9. Worked Examples

### Example A: Cross-Industry Horizontal Switcher

Software engineer (6 yrs, non-climate) → VP Engineering at VPP startup (12 yrs, 8 climate)

| Phase | Computation | Score |
|-------|------------|-------|
| Phase 1 | Self ≠ mentor ✓, capacity 1/2 ✓, no active match ✓, not blocked ✓ | Pass |
| Phase 2 | C_h = \|{Eng}\| / \|{Eng, IT}\| = 0.50 (W=5), C_v = \|{Energy}\| / \|{Energy, Trans}\| = 0.50 (W=1), C_s = \|{Private}\| / \|{Private}\| = 1.00 (W=2). Cat = (5×0.50 + 1×0.50 + 2×1.00) / (5+1+2) = 4.5/8 | **0.563** |
| Phase 3 | T1 "Translating exp" ∈ top3 → 1.0/1, T2 "Job search" ∈ general → 0.6/2, T3 "Networking" ∈ top3 → 1.0/3. Raw = 1.633 / 1.833 | **0.891** |
| Phase 4 | cosine_sim("distributed ledger systems…", "VPP edge orchestration…") | **0.865** |
| Phase 5 | 1.0 × (0.45×0.563 + 0.35×0.891 + 0.20×0.865) = 0.253 + 0.312 + 0.173 | **0.738** |

**Outcome:** High match. The low vertical weight (1/5) prevents domain mismatch from penalizing the candidate, while topic alignment and semantic vectors drive the recommendation.

### Example B: Vertical Policy Specialist

Policy analyst (4 yrs, 2 climate) → Senior Director of Global Climate Policy (15 yrs)

| Phase | Computation | Score |
|-------|------------|-------|
| Phase 2 | C_h=0.50 (W=2), C_v=1.00 (W=5), C_s assumed 1.00 (W=3). Cat = (2×0.50 + 5×1.00 + 3×1.00) / (2+5+3) = 9.0/10 | **0.900** |
| Phase 3 | T1, T2 in top3 strengths → normalized | **0.950** |
| Phase 4 | High policy overlap | **0.910** |
| Phase 5 | 0.45×0.900 + 0.35×0.950 + 0.20×0.910 = 0.405 + 0.332 + 0.182 | **0.920** |

**Outcome:** Ultra-high match. Demonstrates how high vertical weight (5/5) combined with configurable sector weight rewards exact domain and sector expertise.

---

## 10. Resolved Decisions Log

Decisions made during design review, recorded for context.

| # | Question | Decision |
|---|----------|----------|
| 1 | Ingestion method (Airtable/Sheets/form)? | Existing data needs importing. Build a manual import script (CSV/JSON → Postgres). No ongoing sync. |
| 2 | Email-based access security gap | Acceptable for pilot. Magic-link auth added as P1 stretch goal (implement after core features). |
| 3 | How many matches to store vs. show? | Store all scored results (no limit). Show only rank=1 to user. Admin sees everything. |
| 4 | Feedbacks PK (match_id vs feedback_id) | Confirmed: `feedback_id` is PK, `match_id` is FK. Multiple feedbacks per match allowed. |
| 5 | Sector weight fixed at 1.0? | Not intentional. All three axes (horizontal, vertical, sector) are user-configurable 1–5. Formula updated. |
| 6 | Previously rejected match blocks re-matching? | No. Algorithm and post-algo filtering are decoupled. Only ACTIVE matches and explicit block-list entries prevent pairing. Computation payload records prior match history for audit. |
| 7 | Code commit tracking implementation | DigitalOcean provides `COMMIT_HASH` env var at runtime. Local dev falls back to `git rev-parse HEAD`. |
| 8 | No mentors pass eligibility filter | Result page shows "No mentors available." Dashboard (separate page) shows existing matches (may be empty). |
| 9 | User who is "both" can self-match? | No. `E.email != M.email` added to Phase 1 eligibility filter. |
| 10 | Profile change affects active matches? | No. Active matches are immutable — a computation set in stone. Profile snapshots in computation payload preserve the exact inputs. Only future match runs use updated profiles. |
| 11 | Match should capture profile data at match time | Yes. Computation payload includes full `mentee_snapshot` and `mentor_snapshot` with all profile fields as they existed when the algorithm ran. |
| 12 | Top 3 strengths/topics → Top X | Mentor strengths expanded to up to 5. Mentee topics not hardcoded at 3. Topic Score formula generalized: normalize by H(N) (Nth harmonic number) so it works for any count. |
| 13 | Profile fields: display, contact, location | Full profile added: preferred name, pronunciation, pronouns, photo (URL), career level, certifications, interests/hobbies, fun fact, links (LinkedIn, phone, website, calendly, etc. as flat object). All in JSON payload. |
| 14 | Geographic matching | P1: string-based location matching behind a `computeGeoScore()` function. Opt-in via `geo_match_preference`. When enabled, geo gets 0.15 weight and other component weights adjust. Future: swap internals to geocoding + haversine distance without changing the algorithm interface. |
| 15 | Profile field naming | Profile uses generic names ("areas worked in", "areas want to work in"). These map to algorithm terms (horizontal/vertical) inside the matching engine. UI shows the generic names. |
