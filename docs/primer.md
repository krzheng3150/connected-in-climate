# Design Primer (AI Context)

Full design doc: `docs/design.md` | [Google Doc](https://docs.google.com/document/d/1n1yqMimYnSUDaC_lV49F4yo33U1V3lm_/edit)

## What this is

A mentor/mentee matching platform for climate tech. A mentee clicks "Find a Mentor", the algorithm scores every eligible mentor, stores all results, and shows the top match. Mentors don't initiate — they see mentees who matched with them.

## Algorithm (5 phases)

1. **Eligibility filter** — hard gates: no self-match, mentor has capacity, no active duplicate, not on block list.
2. **Categorical scoring** — weighted Jaccard overlap on three axes (horizontal career areas, vertical climate areas, sectors). Mentee sets weights 1–5 per axis.
3. **Topic alignment** — rank-discounted match of mentee's priority topics against mentor's top strengths (1.0) and general topics (0.6). Normalized by H(N) so score is [0,1] for any topic count.
4. **Semantic similarity** — cosine similarity of TF-IDF embeddings (mentee statement of intent vs mentor motivation). Computed at import, not at match time.
5. **Final synthesis** — weighted blend: 0.45 categorical + 0.35 topic + 0.20 semantic. With geo enabled: 0.40/0.30/0.15/0.15. Reliability multiplier defaults to 1.0 (future: feedback-derived).

## Key design decisions

- **Matches are immutable.** A computation_payload snapshots both profiles and all scores at match time. Profile changes only affect future runs.
- **Block list ≠ rejection.** `rejections` table is a block list (prevents future matching). Rejecting a match does NOT auto-block — admin decides separately.
- **Store all, show one.** All scored mentors are stored. Only rank=1 is shown to the user. Admin sees everything.
- **JSONB for dynamic fields.** Stable columns for queries (`email`, `name`, `role`); everything else in `payload`. No schema migrations for new profile fields.
- **Email-based auth** for the pilot. Admin gated by `ADMIN_EMAILS` env var.

## Profile field propagation

New field → `server/field-registry.js` → `scripts/import.js` → `client/src/components/ProfileFields.jsx` (LABELS + FIELD_NAMES + FIELD_ORDER) → `scripts/sample-profiles.csv`

## Milestones

- **P1 (pilot):** Import, matching, email-based views, feedback, admin panel, action tracking. Magic-link auth is stretch.
- **P2:** OAuth login, role assignment, quick-links for scheduling.
- **P3:** Payments, incentives, AI feedback evaluation, AI application gateway.
