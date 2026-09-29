# flashyid-spec — `delegation/1`

<img src="brand/assets/bolt-gold.svg" width="48" alt="">

The vendor-neutral specification for cryptographically provable delegated
authority for agents — the identity layer of the agentic internet — for anyone
who needs to issue, carry or check a chain of authority that runs human →
organisation → agent → sub-agent → session and can never grow on the way down.

This repository holds the spec, a JSON Schema, test vectors and a
dependency-free checker. The implementation — an OIDC provider and the
`@flashyid/sdk` grant kernel — lives in
[FlashyLabs/flashyid](https://github.com/FlashyLabs/flashyid); every rule here
is seeded from it and says so.

## Quick start

Nothing to install. Node 22 or later.

```bash
node vendor-delegation.mjs check vectors/valid/three-hop.json
node vendor-delegation.mjs check vectors/invalid/widened-scope.json
npm test
```

The first prints the authority in effect at the leaf and exits 0. The second
names the refusal (`scope_widened` at `chain[1].scopes`) and exits 1. The
third runs every vector and every rule with `node --test`.

## What makes it different

**Attenuation only.** A child grant may carry a subset of its parent's scopes,
a cap no higher, an expiry no later and the same or a narrower purpose. Any
widening is refused with a named reason — never clamped, never averaged. An
agent can act on a person's authority and can never exceed it.

**Enforcement before minting.** Every grant names, in `enforcedBy`, the https
endpoint that checks it before anything acts on it. A grant with no checker is
refused. Authority that nothing checks is theatre.

**Bind subject to holder.** A verifier walks the chain: each grant's issuer is
the holder of the grant above, the root is a person or an organisation and
never a machine, and the principal acting must be the leaf's subject. A valid
signature over somebody else's chain authorises nothing.

And the rest of the estate's doctrine that follows from those: every grant
expires and is revocable, revocation is immediate and walks down, caps are
integer minor units, unknown keys are refused unless `x-` prefixed, and the
checker refuses rather than guesses.

## Layout

| Path | What it is |
|---|---|
| `SPEC.md` | The contract: document shape, field rules, refusals, verification, what version 1 does not carry |
| `schema/delegation-1.json` | JSON Schema draft 2020-12 for the structure; only `x-` extra keys allowed |
| `vendor-delegation.mjs` | The checker: `validate(doc)`, `verifyChain(doc, opts)`, `signingInput(grant)`, and the CLI. `node:` builtins only |
| `vectors/valid/` | Documents that verify: single-hop, three-hop, with `x-` extensions |
| `vectors/invalid/` | Documents that refuse, each named for its refusal |
| `test/delegation.test.mjs` | `node --test`: every vector, a unit test per rule, the schema pinned to the checker, the CLI, and that these documents say what the code does |
| `tools/lint.mjs` | `node --check` every `.mjs`, parse every `.json`, hold the house rules |
| `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` | How to work here |

## What the checker does not do

It does not verify a signature. `delegation/1` fixes what is signed — the
canonical JSON of the grant without its `signature` field — and mandates no
algorithm and no key distribution; those are the implementation's. The
vectors are unsigned (`signature: null`) for that reason, and the CLI says
`signed: no — structural check only` so nobody mistakes a structural pass for
a cryptographic one.

## Links

- Reference implementation: [FlashyLabs/flashyid](https://github.com/FlashyLabs/flashyid) — the OIDC provider, `@flashyid/sdk` (the grant kernel this spec is seeded from), and the rail issuance, consent and grant surfaces.
- Sibling standards in this estate, by name: `intent/1`, `ritual/1`, `aao/0.1`, `trust/1`. A `delegation/1` root is typically the `accountableTo` of an `aao/0.1` charter.

## Where it sits in the stack

`delegation/1` is the identity layer of Web 4 — the agentic internet as a stack
of open protocols. The human map of the whole stack is
[web4](https://github.com/FlashyLabs/web4); its machine twin is
[stack.json](https://github.com/FlashyLabs/stack.json), served at
`/.well-known/stack.json`. This repository serves its own institutional front
door — the same config-driven, dependency-free door every protocol repository in
the estate serves — generated into `site/` by `node scripts/build-site.mjs` from
`site.config.json` and its vendored inputs. It is committed here and, once
deployed, is served at `https://flashylabs.github.io/flashyid-spec/` (committed
as of 2026-09-29, not yet fetched).

Status: draft. No independent adopter yet; the first is the gate before this is called a standard.

Licence: to be declared at launch. The estate licence register in flashyos governs; this repository is not yet open-sourced.
