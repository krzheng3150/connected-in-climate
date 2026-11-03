# Design Primer (AI Context)

Full design doc: `docs/design.md` | [Google Doc](https://docs.google.com/document/d/1n1yqMimYnSUDaC_lV49F4yo33U1V3lm_/edit)

## What this is

A mentor/mentee matching platform for climate tech. A mentee clicks "Find a Mentor", the algorithm scores every eligible mentor, stores all results, and submits the top candidates for admin review. Admin narrows to 1–3, mentee picks if multiple. Mentors don't initiate — they see mentees who matched with them.

## Algorithm (5 phases)

1. **Eligibility filter** — hard gates: no self-match, mentor has capacity, no active duplicate, not on block list.
2. **Categorical scoring** — weighted Jaccard overlap on three axes (horizontal career areas, vertical climate areas, sectors). Mentee sets weights 1–5 per axis.
3. **Topic alignment** — rank-discounted match of mentee's priority topics against mentor's top strengths (1.0) and general topics (0.6). Normalized by H(N) so score is [0,1] for any topic count.
4. **Semantic similarity** — cosine similarity of TF-IDF embeddings (mentee statement of intent vs mentor motivation). Computed at import, not at match time.
5. **Final synthesis** — weighted blend: 0.45 categorical + 0.35 topic + 0.20 semantic. With geo enabled: 0.40/0.30/0.15/0.15. Reliability multiplier defaults to 1.0 (future: feedback-derived).

## Key design decisions

- **Matches are immutable.** A computation_payload snapshots both profiles and all scores at match time. Profile changes only affect future runs.
- **Block list ≠ rejection.** `rejections` table is a block list (prevents future matching). Rejecting a match does NOT auto-block — admin decides separately.
- **Multi-match review pipeline.** Algorithm scores all mentors, top N (default 5) get `PENDING_REVIEW` for admin, rest stored. Admin approves 1–3, mentee picks if >1. If admin approves exactly 1, it auto-activates.
- **JSONB for dynamic fields.** Stable columns for queries (`email`, `name`, `role`); everything else in `payload`. No schema migrations for new profile fields.
- **Email-based auth** for the pilot. Admin gated by `ADMIN_EMAILS` env var.

## Match status lifecycle

```
PENDING_REVIEW → ADMIN_APPROVED → ACTIVE → FINISHED
                                ↘ REJECTED
               → REJECTED
STORED (below top N, kept for audit)
```

- `PENDING_REVIEW` — algorithm generated, waiting for admin review
- `ADMIN_APPROVED` — admin kept, waiting for mentee to pick (or auto-activated if only 1)
- `ACTIVE` — confirmed match, visible to both parties
- `REJECTED` — admin or mentee declined
- `FINISHED` — match completed
- `STORED` — below the top-N cutoff, kept for audit

Mentee cannot re-run matching while any match is PENDING_REVIEW, ADMIN_APPROVED, or ACTIVE.

## Profile field propagation

New field → `server/field-registry.js` → `scripts/import.js` → `client/src/components/ProfileFields.jsx` (LABELS + FIELD_NAMES + FIELD_ORDER) → `scripts/sample-profiles.csv`

## Milestones

- **P1 (pilot):** Import, matching, email-based views, feedback, admin panel, action tracking. Magic-link auth is stretch.
- **P2:** OAuth login, role assignment, quick-links for scheduling.
- **P3:** Payments, incentives, AI feedback evaluation, AI application gateway.
