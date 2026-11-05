# Design Primer (AI Context)

Full design doc: `docs/design.md` | [Google Doc](https://docs.google.com/document/d/1n1yqMimYnSUDaC_lV49F4yo33U1V3lm_/edit)

## What this is

A mentor/mentee matching platform for climate tech. A mentee clicks "Find a Mentor", the algorithm scores every eligible mentor, stores all results as a **match run**, and submits the top candidates for admin review. Admin batch-reviews the run (approve/reject all at once), mentee picks if multiple approved. Mentors don't initiate — they see mentees who matched with them.

## Algorithm (5 phases)

1. **Eligibility filter** — hard gates: no self-match, mentor has capacity (only ACTIVE matches count against capacity), no in-progress duplicate (ACTIVE/CANDIDATE/APPROVED), not on block list.
2. **Categorical scoring** — weighted Jaccard overlap on three axes (horizontal career areas, vertical climate areas, sectors). Mentee sets weights 1–5 per axis.
3. **Topic alignment** — rank-discounted match of mentee's priority topics against mentor's top strengths (1.0) and general topics (0.6). Normalized by H(N) so score is [0,1] for any topic count.
4. **Semantic similarity** — cosine similarity of TF-IDF embeddings (mentee statement of intent vs mentor motivation). Computed at import and at profile creation/edit, not at match time.
5. **Final synthesis** — weighted blend: 0.40 categorical + 0.30 topic + 0.15 semantic + 0.15 experience. With geo enabled: 0.35/0.25/0.15/0.15/0.10. Reliability multiplier defaults to 1.0 (future: feedback-derived).

## Key design decisions

- **Match runs are first-class entities.** A `match_runs` row groups all candidates from one algorithm execution. Admin actions happen at the run level (batch review), not per-match.
- **Matches are immutable snapshots.** A `computation_payload` snapshots both profiles and all scores at match time. Profile changes only affect future runs.
- **Block list ≠ rejection.** `rejections` table is a block list (prevents future matching). Rejecting a match does NOT auto-block — admin decides separately.
- **Multi-match review pipeline.** Algorithm scores all mentors, top N (default 5) become `CANDIDATE` for admin review, rest `STORED`. Admin batch-reviews the run: selects which to approve, rest rejected. If exactly 1 approved → auto-activates. If 2–3 approved → mentee picks. If 0 approved → run cancelled.
- **JSONB for dynamic fields.** Stable columns for queries (`email`, `name`, `role`); everything else in `payload`. No schema migrations for new profile fields.
- **Clerk auth.** Social login (Google, LinkedIn, Microsoft) via Clerk. Admin gated by `ADMIN_EMAILS` env var. Users without a profile see a self-service application form.

## Run status lifecycle

```
match_runs:  PENDING_REVIEW → AWAITING_MENTEE → ACTIVE
                             → ACTIVE (auto, if 1 approved)
                             → CANCELLED (0 approved, or admin rejects active match)
```

## Match status lifecycle

```
CANDIDATE → APPROVED → ACTIVE → FINISHED
          → REJECTED
STORED (below top N, kept for audit)
```

- `CANDIDATE` — in the top N, waiting for admin batch review
- `APPROVED` — admin kept, waiting for mentee to pick (or auto-activated if only 1 in run)
- `ACTIVE` — confirmed match, visible to both parties
- `REJECTED` — admin declined during batch review, or mentee picked a different approved match
- `FINISHED` — match completed
- `STORED` — below the top-N cutoff, kept for audit

Mentee cannot re-run matching while any run is PENDING_REVIEW, AWAITING_MENTEE, or ACTIVE.

## Profile field propagation

New field → `server/field-registry.js` → `scripts/import.js` → `client/src/components/ProfileFields.jsx` (LABELS + FIELD_NAMES + FIELD_ORDER) → `client/src/components/ApplicationForm.jsx` → `server/profile-api.js` (field set) → `scripts/sample-profiles.csv`

## Milestones

- **P1 (pilot):** ✅ Import, matching, feedback, admin panel, action tracking, Clerk OAuth login, self-service application form, profile editing, email notifications.
- **P2:** Quick-links for scheduling, enhanced admin analytics.
- **P3:** Payments, incentives, AI feedback evaluation, AI application gateway.
