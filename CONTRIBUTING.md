# Contributing

## Commands

Nothing to install. Node 22 or later.

```bash
npm run lint    # node --check every .mjs, parse every .json, hold the house rules
npm test        # node --test test/*.test.mjs — every vector, every rule, the CLI, the schema pin
node vendor-delegation.mjs check vectors/valid/three-hop.json
node vendor-delegation.mjs check vectors/invalid/widened-scope.json   # exits 1
```

## Spec first, in this order

A change lands as text before it lands as code, and each step is checked by
the one after it:

1. **SPEC.md** — state the rule, and add or rename the refusal in the
   Refusals table. If the rule cannot be written down, it is not ready.
2. **schema/delegation-1.json** — change the shape if the shape changed.
   `test/delegation.test.mjs` pins the schema's required keys to the checker's
   `GRANT_KEYS`, so the two cannot drift.
3. **vendor-delegation.mjs** — make the checker refuse exactly what the spec
   refuses. It imports `node:` builtins only, and stays that way.
4. **vectors/** — add a vector for every new refusal under `vectors/invalid/`,
   named for the refusal (`<refusal-name>.json`), and a valid vector if the
   change adds anything a valid document may now carry. The test suite maps
   filenames to refusal codes; a vector that no test names does not exist.
5. **test/delegation.test.mjs** — a unit test per rule, and the vector map.

A change that would let a child grant carry more than its parent — a wider
scope, a higher cap, a later expiry, a broader purpose, a machine at the root
— is refused at review regardless of its other merits. That invariant is the
specification.

## What a pull request needs

The template asks for the checklist above and for which branch you measured.
`main` is not necessarily the default branch in this estate; ask
`git symbolic-ref --short refs/remotes/origin/HEAD` and say what it answered.

Commit no secret, no `LICENSE` file, no dependency, and no number you did not
measure.
