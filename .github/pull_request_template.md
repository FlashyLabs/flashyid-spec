## What this changes

<!-- One paragraph. -->

## Spec-first checklist

Changes land in this order, and a PR that skips a step is sent back:

- [ ] SPEC.md states the rule (or this PR changes no rule)
- [ ] schema/delegation-1.json agrees with SPEC.md
- [ ] vendor-delegation.mjs refuses what SPEC.md refuses, and nothing more
- [ ] vectors/ carry a vector for every new refusal, named for it
- [ ] test/delegation.test.mjs covers it
- [ ] `npm run lint && npm test` pass with nothing installed
- [ ] No grant can carry more than its parent after this change
- [ ] No LICENSE file, no dependency, no secret, no fabricated figure

## Which branch you measured

<!-- `git symbolic-ref --short refs/remotes/origin/HEAD` -->
