# Agent standards for this repo

Rules for any AI agent (Claude, Codex, Cursor, or other) working in this
codebase. Every rule below exists because an agent broke it here during the
3.0.0 push and another agent had to find and fix the damage. Read `CLAUDE.md`
first for architecture; this file is about **how to work**, not what the code
does.

## 1. Coordination

- **Check whether another agent is active before editing.** `git status`, then
  look at file mtimes (`stat -f "%Sm" <file>`). If files you plan to touch
  changed in the last few minutes and you didn't change them, stop and ask the
  user who owns what. _What happened: two agents edited `UI.ts` concurrently
  and shipped two parallel pointer-capture implementations (`activePointerId`
  and `capturedPointerId`) in one file._
- **Never discard another agent's uncommitted work.** `git checkout -- .`,
  `git restore`, and deleting untracked files destroy changes git cannot
  recover — there is no stash, no dangling commit, nothing to `fsck` for. A
  reviewing agent wiped an in-progress relicensing this way and it had to be
  redone from scratch. If you believe uncommitted changes are wrong, stop and
  ask; if you must clear the tree, `git stash -u` first so it is recoverable.
- **Never commit another agent's uncommitted work inside your own commit.**
  Stage only paths you changed; `git add -A` is how unrelated in-flight work
  gets frozen into your commit message's story.
- **Stay in your assigned area.** If you were given the engine, don't "quickly
  fix" CI. Flag it instead.

## 2. Correctness over green

- **A test that passes while the live behavior is broken is a liability.** Do
  not stub the exact mechanism under test (`startAnimation` as a no-op in a
  test about animation completion), and do not weaken an assertion until it
  passes. If you can't make the real assertion pass, say so. _What happened:
  golden e2e "tests" wrote screenshots and asserted nothing; a controlled-page
  test was loosened until it passed without the engine turning at all._
- **Do not raise a budget to make a gate green.** The size ceiling has been
  raised twice (35→45→47 kB). It does not move again; shrink the code or ask.
  The same applies to coverage thresholds and lint severity: gates only ratchet
  toward strict.
- **Quality gates must measure something.** A "quality" script that checks
  files exist, or two size-limit entries that both measure brotli while
  claiming one is raw, is theater. If you add a gate, prove it can fail: break
  the thing, watch the gate go red, fix it back.
- **A gate you did not wire up is not a gate.** `scripts/check-coverage-areas.mjs`
  was written with per-file floors, given an npm script, and left out of
  `quality:ci` — so nobody noticed it failed on the very code that shipped it.
  Adding a check means adding it to `quality:ci` _and_ watching it run.
- **Never push with the gate red.** `pnpm quality:ci` is the definition of done.
  It has been pushed red three separate times: an unformatted markdown file, a
  size budget the committed code already exceeded, and a coverage floor the
  committed code missed. Run it; do not assume.
- **Optimising for a number must be justified against what it costs.** Helper
  names were golfed to `iseg`/`lim`/`ang` and error messages to "Bad page" to
  chase a raw-byte budget. Measured return: **19 bytes** — because those symbols
  are module-internal and terser already mangles them. Measure the win before
  you spend readability on it, and prefer the metric consumers actually pay
  (transfer size) over a proxy.

## 3. Scope of a change

- **Every behavior change goes in the commit message and, if user-visible, in
  `CHANGELOG.md`.** _What happened: `preventDefault` on mouse pointerdown, a
  new `pointerleave` handler, and removal of the opaque background from
  `simpleDraw` all rode along unmentioned in a commit about four other fixes._
- **Every public API change gets a `MIGRATION.md` entry** — including type-level
  changes. Making `loadFromImages` return a `Promise`, or exposing
  `attachMode`/`replacePages` as public, is API. If a member is public only for
  internal wiring, mark it `@internal`.
- **Autofixes are reviewed, not trusted.** Run `eslint --fix` per-rule or
  per-file and read the diff. _What happened: a blanket `prefer-template` fix
  mangled template literals into `` `--${  density}` `` across the Page
  renderers._

## 4. Engine-specific traps

These are the mistakes specific to this codebase. `CLAUDE.md` has the full
invariant list; these are the ones agents actually got wrong:

- **Nullability is a boundary design, not a style choice.** Internals that
  don't exist before `loadFromHTML` are `| null` **privately**; public getters
  keep non-null signatures and throw `PageFlipError('NOT_LOADED')`. Do not
  "clean up" either half: definite-assignment `!` makes the published `.d.ts`
  lie (callers get `undefined` at runtime), and nullable public getters break
  every consumer for a state they can't observe. Both directions were tried
  here; both were wrong.
- **RTL means the turn direction, never the pointer coordinates.** Mirroring x
  in `getMousePos` makes the fold run away from the finger. The inversion
  lives in `Flip.getDirectionByPoint` and `UI.swipeDirection`; programmatic
  turns pass an explicit direction. If you touch one input path, check all
  four: click, corner fold, drag, swipe.
- **React owns the page elements; the engine only borrows them.** Never
  `innerHTML = ''` inside `.stf__block`, never reparent nodes React rendered
  without going through the portal structure in `HTMLFlipBook.tsx`. Symptom of
  getting this wrong: `NotFoundError` on child removal.
- **Effect dependencies are load-bearing.** An inline `onFlip={...}` must not
  rebuild the `PageCollection` — handlers dispatch through a ref, and the
  rebuild is gated on the page **nodes** changing by reference. If your change
  makes a flip re-run `updateFromHtml`, you broke it.
- **Instant turns (`flippingTime: 0`, reduced motion) run `onAnimateEnd`
  synchronously.** State inspected after `flip()` returns is post-animation
  state; treating that as failure re-creates a shipped bug.

## 5. Decisions that are not yours to make

Some choices are the repository owner's, and an agent making them autonomously
is a defect no matter how well-reasoned the change is.

- **Licensing.** The core's move from MIT to MPL-2.0 was authorised by the
  repository owner — do not "correct" it back. What is not an agent's call is
  _initiating_ a change like it. An agent relicensed the engine, rewrote
  LICENSE and NOTICE, stamped headers across 30 files and invented trademark
  language before anyone had approved it; a reviewing agent then reverted the
  lot and destroyed uncommitted work. Both halves were wrong. Propose, get a
  yes, then implement — and if you find licensing changes you did not make,
  ask before touching them.
- **Versioning and release timing**, publishing to npm, deprecating a version.
- **The public API surface.** Adding a prop or an event is a product decision;
  propose it, don't ship it.
- **Anything that changes what a consumer is legally or contractually
  obliged to do.**

If you believe one of these should change, say so and stop. A paragraph of
justification in a commit message is not authorisation.

## 6. Toolchain and releases

- **Verify version compatibility beyond "it installs".** `pnpm install`
  succeeding is not evidence. TypeScript must stay inside typescript-eslint's
  declared peer range or every type-aware lint rule silently disables — the
  preflight (`scripts/quality.mjs`) now enforces this; do not delete or bypass
  that check to "unblock" an upgrade.
- **Release mechanics get verified against a working repo, not reasoned from
  memory.** The reference is `GulLabs/any-llm` (publishes `@gullabs/*` today).
  _What happened: an agent shipped an OIDC-only publish workflow with no
  trusted publisher registered and no token — it would have failed closed after
  tagging. Another flipped a changeset from `major` to `patch` "to keep 3.0.0"
  and would have published 3.0.1._
- **Do not describe infrastructure as existing when it requires external setup
  that hasn't happened.** Docs must say "this requires X on npmjs.com first",
  not present the aspiration as current state.
- **Prove the publish artifact.** Before touching release code: delete `dist/`,
  `pnpm pack` both packages, list the tarballs, load the CJS entry in plain
  Node. Empty-tarball and broken-require bugs are found here, not on npm.
- **CI runs Linux; your laptop does not.** Anything platform-shaped has to be
  verified for the runner, not just locally. Screenshot baselines are named
  `<name>-<project>-<platform>.png`, so a macOS-only set fails every CI run —
  regenerate with `pnpm test:e2e:golden:update:linux`. Likewise, each CI job is
  a fresh runner: `needs:` orders jobs, it does not share `dist/`, so a job that
  needs built packages must build them itself.
- **Definite assignment (`!`) is allowed only for a constructor invariant you
  can point at, and it must be pinned by a test.** `UI.distElement!` is sound
  because `PageFlip.ui` stays null until a load completes; `packages/core/tests/
lifecycle.test.ts` is what keeps that true. Without such a test, use the
  nullable-internals / guarded-accessor pattern in §4.

## 7. Before you hand back

Run the same bar CI runs, from the actual state of the tree:

```bash
pnpm quality:ci
```

Then report honestly: what you changed, what you verified and how, what you
did **not** do, and anything you noticed but left alone. "Done" with a failing
gate, or a summary that omits a behavior change, costs more than the fix.
