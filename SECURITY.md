# Security

This repository holds a specification and a checker for delegated authority.
A weakness here is one that lets a grant carry more than its parent, lets an
expired or revoked grant verify, or lets a chain root at a machine — in any
implementation that follows the text. Report those privately.

**Contact:** security@flashylabs — *to be confirmed before launch; this address
is the estate's stated convention and had not been verified as monitored when
this file was written.* Until it is confirmed, also raise the matter with the
maintainer of FlashyLabs/flashyid, the reference implementation.

Please include the smallest `delegation/1` document that demonstrates the
problem and the command that shows the checker accepting it. Do not open a
public issue for a weakness; the issue templates link here for that reason.

What is in scope: SPEC.md, `schema/delegation-1.json`, `vendor-delegation.mjs`,
and the vectors. What is not: the OIDC provider, key handling and signature
verification, which live in FlashyLabs/flashyid and have their own process.

No secret belongs in this repository, in any file, at any time.
