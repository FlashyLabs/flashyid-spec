# delegation/1

**Status: draft.** Contract name: `delegation/1`. Nothing outside this
repository and FlashyLabs/flashyid has adopted it; a first independent adopter
is the gate before it is called a standard.

## What it is

A `delegation/1` document is a **chain of grants**: an ordered array, root
first, in which a person or an organisation delegates bounded authority to an
organisation, an agent, a sub-agent or a session, and each hop carries no more
than the hop above it. It is the wire form of the delegation kernel in
`@flashyid/sdk` (`packages/sdk/src/grants/`), stated so that a party that has
never installed anything of ours can check one.

The chain is: human → organisation → agent → sub-agent → session. Not every
chain has every hop; every chain has a person or an organisation at the root.

## The document

A three-hop example — person → org → agent → session. This is
`vectors/valid/three-hop.json`, unsigned.

```json
{
  "contract": "delegation/1",
  "chain": [
    {
      "id": "grant/root-0001",
      "issuer": "person/example-human",
      "subject": "org/example-org",
      "scopes": ["rewards:redeem", "rewards:transfer", "ledger:read"],
      "cap": 1000000,
      "expires": "2099-01-01T00:00:00Z",
      "purpose": "settlement",
      "enforcedBy": "https://rails.example/v1/redeem/execute",
      "signature": null
    },
    {
      "id": "grant/org-0002",
      "issuer": "org/example-org",
      "subject": "agent/example-org-settlement",
      "scopes": ["rewards:redeem", "ledger:read"],
      "cap": 250000,
      "expires": "2098-06-30T00:00:00Z",
      "purpose": "settlement/redeem",
      "enforcedBy": "https://rails.example/v1/redeem/execute",
      "signature": null
    },
    {
      "id": "grant/session-0003",
      "issuer": "agent/example-org-settlement",
      "subject": "session/2fd4e1c67a2d28fced849ee1bb76e739",
      "scopes": ["rewards:redeem"],
      "cap": 5000,
      "expires": "2098-06-29T12:00:00Z",
      "purpose": "settlement/redeem/one-draft",
      "enforcedBy": "https://rails.example/v1/redeem/execute",
      "signature": null
    }
  ]
}
```

Read down the chain: scopes shrink, the cap falls, the expiry comes forward,
the purpose gets more specific, and each issuer is the subject of the grant
above. The authority in effect at the leaf is the session's — `rewards:redeem`,
5000 minor units, until 2098-06-29T12:00:00Z — and nothing on the way down
could have made it larger.

### Top level

| Key | Rule |
|---|---|
| `contract` | Required. Exactly `"delegation/1"`. |
| `chain` | Required. A non-empty array of grants, root first. |
| `x-*` | Any key beginning `x-` is an extension: carried, signed, never interpreted. |

Any other top-level key is refused (`unknown_key`). The parser refuses; it does
not guess.

### Field rules — every key on every grant is required

| Field | Type | Rule |
|---|---|---|
| `id` | string | Non-empty; unique within the chain. The unit of revocation. |
| `issuer` | id | `<kind>/<slug>` where kind ∈ `person`, `org`, `agent`, `session` and slug matches `[a-z0-9][a-z0-9._-]*`. On `chain[0]`, kind must be `person` or `org`. On every later grant, must equal the `subject` of the grant above. |
| `subject` | id | Same form. Who holds this grant. |
| `scopes` | string[] | Non-empty, unique. On every grant after the root, a subset of the parent's. |
| `cap` | integer | Minor units — Flashy Gold has two decimals, so 25.00 is `2500`. A JSON integer ≥ 0, never a float, never a string. On every grant after the root, ≤ the parent's. Required on the root too: an uncapped grant is not a grant this contract carries. |
| `expires` | string | ISO 8601 with seconds and an explicit zone (`Z` or `±hh:mm`). On every grant after the root, no later than the parent's (compared as instants). A grant is expired at its own expiry instant. |
| `purpose` | string | A slug path: `settlement`, `settlement/redeem`. On every grant after the root, equal to the parent's or the parent's followed by `/` and more. |
| `enforcedBy` | string | An `https://` URL naming the enforcement point that checks this grant before anything acts on it. Hops may name different points; the leaf's is the one in effect. |
| `signature` | null or object | `null` (unsigned) or `{ "alg": string, "value": string, "kid"?: string }`. What is signed is defined below; the algorithm is not. |
| `x-*` | any | Extensions: carried and signed, never interpreted. |

Any other grant key is refused (`unknown_key`) — including every other
spelling of expiry (`expiry`, `exp`, `expiresAt`, `ttl`). A field that could be
spelled two ways is a field two implementations will disagree about.

### Ids

The directory form is used: `person/<slug>`, `org/<slug>`, `agent/<slug>`,
`session/<slug>`. flashyid's SDK authenticates machines as `agent:<org>/<name>`
and bridges to the directory form with `fromDirectoryId` / `toDirectoryId`
(`packages/sdk/src/grants/subject.ts`); a document carries the directory form.
`session/` ids are opaque; the example uses a hex string because a session id
must never be derived from anything a person could be identified by.

## Invariants

All five are inherited from flashyid, where each is enforced by a test, and
each maps to a named refusal below.

1. **Delegation is attenuation, never inheritance.** A child grant carries a
   subset of its parent's scopes, a cap ≤ the parent's, an expiry ≤ the
   parent's, and the same or a narrower purpose. Any widening is refused, on
   the wire, with its own reason — never clamped. (flashyid's `attenuate`
   refuses a widened scope or limit at construction and *clamps* a child expiry
   to its parent's; `verifyChain` there folds the minimum. This contract
   refuses a later child expiry in the document instead, because a document
   that says one thing and means another is exactly what a wire format must
   not carry.)
2. **Enforcement before minting.** Every grant names its enforcement point in
   `enforcedBy`. Authority that nothing checks is theatre; a grant with no
   checker, or one reachable over plain http, is refused.
3. **Assertions bind subject to holder.** A relying party verifies the
   *chain*, not just a signature: each grant's `issuer` is the `subject` of the
   grant above, and the principal acting must be the leaf's `subject`. A
   genuine signature over a chain delegated to somebody else authorises nothing.
4. **Every grant expires and is revocable, and revocation is immediate.**
   `expires` is required on every grant. Revocation is by `id`: a verifier
   evaluates the chain against the revocation state its enforcement point
   holds at that instant, and a revoked grant — or any ancestor of it — refuses
   the chain from that hop down. The document does not carry revocation state,
   because a document cannot be un-issued; the enforcement point holds it.
5. **The root is a person or an organisation, never an agent, and each hop is
   signed by its parent.** `chain[0].issuer` is `person/` or `org/`; a machine
   at the root would be authority with nobody to ask why. Every grant's
   signature is made by its `issuer` — which, by rule 3, is the holder of the
   grant above.

## Refusals

The checker refuses with exactly these codes. A relying party may branch on
them; an auditor needs them to say *why* a chain did not hold.

| Code | When | Why |
|---|---|---|
| `not_an_object` | The document is not a JSON object. | |
| `unknown_key` | A key at the top level or on a grant is neither named here nor `x-` prefixed. | Refuse, don't guess: an unknown key is one two implementations read differently. |
| `missing_field` | A required key is absent. | Every grant field is load-bearing. |
| `bad_type` | A value has the wrong type (`chain` not an array, `scopes` not an array of strings, …). | |
| `bad_contract` | `contract` is not `"delegation/1"`. | |
| `empty_chain` | `chain` is `[]`. | Delegates nothing. |
| `bad_id` | An `issuer` or `subject` is not `<kind>/<slug>`. | An identifier that reads as an identity and resolves to nothing. |
| `duplicate_id` | Two grants share an `id`. | The id is the unit of revocation; an ambiguous one cannot be revoked. |
| `agent_root` | `chain[0].issuer` is an `agent/`. | A machine has no authority of its own; it acts *for* somebody and the somebody answers. |
| `bad_root` | `chain[0].issuer` is any other non-principal kind (`session/`). | Same reason. |
| `empty_scopes` | A grant's `scopes` is `[]`. | Grants nothing; would be invisible to enforcement. |
| `duplicate_scope` | A scope is listed twice. | |
| `cap_not_integer` | `cap` is a float, a string, not finite, or beyond the safe-integer range; or the raw text spells it with a fraction or an exponent. | Money is minor integer units. `2500.0` parses to `2500`, so the CLI reads the bytes before the parser rounds them. |
| `cap_negative` | `cap` < 0. | |
| `bad_expiry` | `expires` is not ISO 8601 with seconds and an explicit zone. | A zoneless timestamp is a guess about where the issuer stood. |
| `bad_purpose` | `purpose` is not a slug path. | |
| `enforced_by_missing` | A grant has no `enforcedBy`. | Enforcement before minting. |
| `enforced_by_not_https` | `enforcedBy` is not an `https://` URL. | An enforcement point a network can impersonate is not one. |
| `bad_signature` | `signature` is neither `null` nor `{ alg, value, kid? }`. | |
| `broken_chain` | A grant's `issuer` is not the `subject` of the grant above. | Bind subject to holder. |
| `scope_widened` | A grant carries a scope its parent does not. | Attenuation only. |
| `cap_exceeds_parent` | A grant's `cap` is greater than its parent's. | Attenuation only. |
| `expiry_later_than_parent` | A grant's `expires` is after its parent's. | A child never outlives its parent. |
| `purpose_widened` | A grant's `purpose` is not its parent's or a narrowing of it. | Attenuation only. |
| `expired` | At the evaluated instant, a grant's `expires` has passed (`expires ≤ now`). | Reported at every hop whose expiry has passed; an expired ancestor expires everything below it whatever the children say. |
| `revoked` | A grant's `id` is in the revocation set the verifier was handed. | Immediate, and walks down: a revoked ancestor refuses the chain from that hop on. Reported at every revoked hop, highest first. |
| `untrusted_root` | The verifier was given a set of trusted roots and `chain[0].issuer` is not in it. | A sound chain can root at *any* person; a relying party pins the roots it honours, or "verified" means only "belongs to someone, somewhere". An empty set trusts nobody. |

Structural refusals (everything above `broken_chain`) come from `validate`;
the walk refusals come from `verifyChain`, which runs `validate` first and
does not walk a document that fails it. Within the walk every failing rule on
every hop is reported, not only the first.

## Verification

A verifier walks the chain root → leaf and, at each hop, checks that the hop
attenuates. In order:

1. **Structure.** `validate(doc)`: the document is the shape above, ids are
   well-formed, caps are integers, every `enforcedBy` is https, the root is a
   person or an org.
2. **Root trust** (optional but recommended for any relying party that admits
   chains from more than one issuer). `chain[0].issuer` must be in the set of
   roots this enforcement point accepts. flashyid's recommendation is roots
   the estate can name — the `accountableTo` of every charter it federates
   with — and nothing else, by default.
3. **The walk.** For `i` from 0 to the leaf:
   - `chain[i].id` is not revoked;
   - `chain[i].expires` > now;
   - and for `i > 0`: `chain[i].issuer === chain[i-1].subject`;
     `chain[i].scopes ⊆ chain[i-1].scopes`; `chain[i].cap ≤ chain[i-1].cap`;
     `chain[i].expires ≤ chain[i-1].expires`; `chain[i].purpose` equals or
     narrows `chain[i-1].purpose`.
4. **Signatures.** Each grant's `signature` is checked against its `issuer`'s
   key, over the signing input below. **`vendor-delegation.mjs` does not do
   this step** — version 1 mandates no algorithm and no key distribution, so a
   dependency-free checker cannot. It reports `signed: false` when any grant
   carries `signature: null`, and `signed: true` means only that every grant
   carries *a* signature object, not that one was verified. An implementation
   performs this step with the keys it distributes; flashyid signs with its
   OIDC key and publishes the public half in its JWKS.
5. **The effective grant.** If every step holds, the authority in effect is:
   root = `chain[0].issuer`; holder = the leaf's `subject`; scopes = the
   leaf's (already proven a subset of every ancestor's); cap = the minimum
   across the chain; expiry = the earliest across the chain; purpose and
   enforcement point = the leaf's. This is the mapping flashyid ratified for
   the rail (`docs/rail-grant.md`): root = who answers for the value, leaf =
   who moves it.

A verifier then asks a second, separate question — does the effective grant
permit *this* action? — and refuses that with its own reason (`out_of_mandate`
in flashyid's vocabulary). That question belongs to the enforcement point and
is not part of `delegation/1`.

Time is an argument to the verifier, never a clock it reads on its own, so an
auditor re-checking a historical decision evaluates it at the instant it was
made.

### The signing input

The bytes a grant's signature is taken over are the **canonical JSON of the
grant with the `signature` key removed**: keys sorted at every level, arrays
in order, no whitespace, strings as `JSON.stringify` emits them. `x-` keys are
included — an issuer vouches for everything it wrote. `signingInput(grant)` in
`vendor-delegation.mjs` produces exactly these bytes, and `canonicalize` is the
same rule every sealed artefact in this estate is hashed with.

`signature.alg` names the algorithm the implementation chose; `signature.kid`
optionally names the key. Neither is constrained by this version.

## What version 1 does not carry

- **A mandated signature algorithm.** The reference implementation uses EdDSA
  over its OIDC key. Another implementation may choose differently; the
  signing input is fixed so that they agree on *what* is signed.
- **Key distribution.** How a verifier obtains an issuer's public key (a JWKS,
  a directory, a pinned set) is the implementation's.
- **Revocation transport.** The document carries no revocation list. The
  enforcement point holds revocation state and the verifier is handed it.
- **The action vocabulary.** What `rewards:redeem` means, which resources a
  scope reaches, and the human-approval bar for high-impact actions
  (`approval_at_or_above` in flashyid) are the enforcement point's contract,
  not this one's.
- **Resources.** flashyid's kernel carries a `res` list beside `scp`.
  Version 1 folds resource restriction into scope naming; a later version may
  add a `resources` field under the same subset rule.
- **Consent.** A grant authorises an agent to *propose*; moving a holder's
  value still passes the enforcement point's consent gate, where a person
  approves one specific draft. That is `flashy-rails`'s `draft → execute` and
  flashyid's consent token, and neither is a grant.
- **Any claim about adoption.** None exists to make.
