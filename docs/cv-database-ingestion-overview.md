# Connecting Client CV Databases to NEXUS — Plain-Language Overview

*For managers and non-technical stakeholders · 30 July 2026 · Status: proposal, not yet built*

---

## What we're building, in one paragraph

Today a recruiter gets CVs into NEXUS in two ways: uploading files by hand, or
pointing NEXUS at a folder on their computer that it watches. Many clients,
though, already have hundreds or thousands of CVs sitting in their own
systems — a database, an applicant-tracking system, a shared drive. This
project adds a third way in: **the client's system sends each new CV to NEXUS
automatically, and NEXUS screens it against the right search within
minutes — with nobody touching a file.**

---

## The first big decision: who connects to whom?

There were two possible designs:

**Option A — NEXUS reaches into the client's database.** The client gives us
a key to their systems and we go in and read their CVs.

**Option B — the client's system posts CVs to NEXUS.** We give each client a
secure "letterbox" (a private address plus an access code). Whenever a new CV
lands in their system, their side drops a copy into our letterbox.

**We chose Option B**, and the reason is easy to explain to any client:

- **We never hold their keys.** With Option A, a security problem on our side
  could expose every client's candidate data. With Option B, we hold nothing
  of theirs — they hold one access code from us, which we can cancel and
  reissue at any time.
- **It works with anything.** Their IT team, their ATS, or a simple automation
  tool can all "post to a letterbox." We don't have to learn the shape of
  every client's database.
- **Cheaper onboarding.** No network negotiations with client IT. For clients
  with no technical staff, we hand them a small ready-made helper program
  (built in Phase 4) that they run on their side; it watches their database
  and does the posting for them. Their passwords never leave their building.

This matches our service story: connecting a new CV source is something the
MasterTech onboarder sets up with the client on a short call — never
self-serve fiddling inside the app.

---

## The second big decision: what about a pile of 10,000 unlabelled CVs?

Some clients will have one enormous, unsorted CV pile. Screening all 10,000
with AI for every new search would be slow and would burn money for no
benefit — most of those CVs have nothing to do with the role being hired.

Our answer has two parts, depending on whether the client labels their CVs:

### If the CVs are labelled ("buckets")

Many client systems already know which job a CV came in for. When their
system posts a CV to us, it can include that label — for example
`ai-analyst`. In NEXUS, the recruiter starting a search simply picks that
bucket from a list ("ai-analyst · 100 CVs") and:

- all 100 are screened right away, and
- the search **stays subscribed** to the bucket — the moment CV #101 arrives
  with that label, it is screened automatically and appears in the results,
  even if nobody has the app open.

### If the CVs are unlabelled (the 10,000 pile)

NEXUS keeps all of them in the client's private **resume pool** and uses a
two-step funnel:

1. **A fast, free matching step.** When a search is created, NEXUS instantly
   compares the job description against the whole pool using standard
   database text-search — this takes under a second and costs nothing. It
   produces a relevance ranking of all 10,000.
2. **AI screening only for the strong matches.** Only the best matches (up to
   a cap the recruiter can see and adjust — default 200) go through full AI
   screening. The recruiter sees an honest message like: *"We ranked 10,381
   pool resumes — 412 look relevant, screening the top 200."*

Nothing is thrown away: the other CVs stay in the pool for future searches,
and every **new** unlabelled CV that arrives is auto-checked against the
active searches — if it looks like a strong match, it gets screened too.

**Why this matters commercially:** the expensive part (AI screening) is
capped per search regardless of how messy or large the client's CV pile is.
Our costs stay predictable; the client's experience stays fast.

---

## What the recruiter actually sees

Almost nothing new to learn. On the "Start new search" page, next to
"Upload resume files" and "Watch a folder," a third choice appears:
**"Company CV pool"** — with a dropdown to pick a bucket or "all resumes,"
and a line showing how many CVs are connected and when the last one arrived.
Everything after that (progress screen, result bands, outreach queue) is the
product they already know.

---

## Security and trust, in plain terms

- Each client gets their own access code; we store it in scrambled form,
  show it only once, and can revoke it instantly.
- The letterbox only accepts CVs — an access code cannot be used to read
  anything out of NEXUS.
- Every delivery is logged (when, how many, from which code) in the same
  audit trail the rest of the product uses.
- One client's pool is invisible to every other client, and pool CVs follow
  the client's existing data-retention (auto-delete) policy.

---

## How we'll build it — four stages, each usable on its own

**Stage 1 — The letterbox.** The secure receiving endpoint, access codes,
duplicate detection, audit logging. After this stage a client's system can
already deliver CVs to their pool.

**Stage 2 — Searching the pool.** The "Company CV pool" option on the search
form, the bucket picker, and the fast ranking step. After this stage
recruiters can run searches against everything already delivered.

**Stage 3 — Live tracking.** New arrivals are matched to open searches the
moment they land — labelled CVs go straight to their subscribed searches,
unlabelled ones only if they rank as strong matches.

**Stage 4 — The helper program and client guide.** The small ready-made
connector we hand to clients who can't build the posting themselves, plus a
step-by-step onboarding document for their IT contact.

Rough effort: Stages 1 and 2 are the bulk of the work (comparable to the
recent interface redesign); Stage 3 is small; Stage 4 is mostly writing.

---

## What this deliberately does NOT include (yet)

- Direct plug-ins for specific ATS products (Workable, Greenhouse, etc.) —
  a later project; they would simply become another sender to the same
  letterbox.
- Smarter "meaning-based" matching (understanding that "data wrangler" ≈
  "data engineer"). The first version matches on the actual words in the CV;
  the upgrade slots in later without changing anything clients see.
- NEXUS logging into client databases — ruled out permanently, by design.

---

## The one-slide summary

> Clients' systems post each new CV to a private, secure NEXUS letterbox.
> Labelled CVs flow straight into the right search, live. Unlabelled piles —
> even 10,000 strong — are ranked instantly for free, and only the strongest
> matches are AI-screened, so costs stay capped and results stay fast.
> Built in four stages, each independently useful.
