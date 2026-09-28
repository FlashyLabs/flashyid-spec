---
name: Spec change
about: Propose a change to delegation/1 — a field, a rule, a refusal.
title: 'spec: '
labels: spec
assignees: ''
---

## The change

<!-- One paragraph. Field added, rule tightened, refusal renamed. -->

## Does it let any grant carry more than its parent?

<!-- If yes, stop: attenuation-only is the whole point and is not up for
     change in version 1. If no, say why not in one sentence. -->

## Where it lands, in order

- [ ] SPEC.md — the rule, and the Refusals table if a refusal changes
- [ ] schema/delegation-1.json — if the shape changes
- [ ] vendor-delegation.mjs — the check
- [ ] vectors/ — at least one vector that exercises it, named for its refusal
- [ ] test/delegation.test.mjs

## Compatibility

<!-- Does an existing valid vector become invalid, or the reverse? Name it. -->
