# flashyid-spec — `delegation/1`, the spec and nothing else

## What makes this repository different

**It is spec-only.** SPEC.md, a JSON Schema, vectors and one dependency-free
checker. The implementation — the OIDC provider, `@flashyid/sdk`'s grant
kernel, key handling, signature verification, the rail surfaces — is
FlashyLabs/flashyid, and every rule here is seeded from it. If a rule needs
code that is not a pure check over a JSON document, it does not belong here.

**The attenuation invariant is the whole point.** A child grant carries a
subset of its parent's scopes, a cap no higher, an expiry no later, the same or
a narrower purpose; the root is a person or an org, never an agent; each hop's
issuer is the holder above. A change that lets any grant carry more than its
parent is wrong regardless of its other merits, and is refused at review.

**Known, intentional divergence from `@flashyid/sdk` — the child-expiry rule.**
The wire spec **refuses** a child grant whose `expires` is later than its
parent's (`expiry_later_than_parent`); the SDK's `attenuate` **clamps** it down
instead. This is deliberate: a constructor may narrow silently, a wire format a
stranger reads must not say one thing and mean another, so on the wire it
refuses. `scope`, `cap` and `purpose` do not diverge. Do not change the
checker's refuse stance to clamp — it is pinned by a test in
`test/delegation.test.mjs` and documented in SPEC.md under *Known divergence*.

**Nothing is installed, ever.** `node:` builtins only, Node 22, ESM. CI has no
install step. A check that needs an install is a check that can quietly not
run.

**The checker refuses; it does not guess.** Unknown keys are refused unless
`x-` prefixed — including every spelling of expiry but `expires`. A float cap
is refused, and the CLI reads the raw bytes first because `2500.0` parses to
`2500`. A zoneless timestamp is refused. `signed: true` means every grant
carries a signature object, not that one was verified — the checker does not
verify signatures, and README and SPEC say so.

## Commands

```bash
npm run lint    # node --check every .mjs, parse every .json, house rules
npm test        # node --test test/*.test.mjs
node vendor-delegation.mjs check vectors/valid/three-hop.json
```

## Rules — each enforced by a test in `test/delegation.test.mjs`

- Every vector under `vectors/invalid/` is named in the test's refusal map and
  produces that refusal; a vector no test names fails the suite.
- Every valid vector passes `validate`, `verifyChain` and the raw-text path at
  a fixed instant, never the clock.
- `schema/delegation-1.json` and `vendor-delegation.mjs` agree on the required
  keys in both directions, on `additionalProperties: false` plus `^x-` at both
  levels, on `cap` being an integer ≥ 0, on `enforcedBy` being https, and on
  the root being `person|org`.
- Every refusal code the checker exports appears in SPEC.md's Refusals table,
  and every grant field has a row in the field-rules table.
- The README quick start command is run and must exit 0; the README's last
  line is the Apache-2.0 licence line; a LICENSE file exists and carries the
  Apache License with `Copyright 2026 Flashy Labs`.
- The CLI exits 0 on a valid chain, 1 on refusal, 2 on usage or an unreadable
  file — never 0 for anything but a verified chain.

Spec-first order for any change: SPEC.md → schema → checker → vectors → tests
(CONTRIBUTING.md).

## Don't

- Add a dependency or a build step.
- Add a field without a row in SPEC.md, a schema property, a check, a vector
  and a test — in that order.
- Let the checker "verify" a signature. It cannot, and claiming to would be the
  one dishonest line in the repository.
- Put a real person's or organisation's id in a vector. Vectors use
  `example-` slugs and `.example` hosts.
- State a number about adoption. There is none.

## House rules — true in every repository in this estate

**`main` is not necessarily the default branch.** Ask, every time: `git symbolic-ref --short refs/remotes/origin/HEAD`.

**Say which branch you measured.** Reading the working tree tells you about your checkout, not the repository.

**Re-vendor before you trust a vendored change.** Files named `vendor-*.mjs` are byte-identical copies; a stale copy disagrees silently.

**No secret in a file, a repo, or an artifact.** Secret Manager only.

**The licence is declared once**, in `tools/estate-licences.mjs` in flashyos, which names this repository Apache-2.0 (holder Flashy Labs); the committed `LICENSE` is that grant. Do not decide this repository's licence inside it.

**A generated file is regenerated, never hand-edited.**

**Report what happened, including when it is worse than expected.**
