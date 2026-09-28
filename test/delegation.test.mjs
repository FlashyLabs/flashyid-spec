import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  CONTRACT,
  GRANT_KEYS,
  DOCUMENT_KEYS,
  REFUSALS,
  validate,
  verifyChain,
  checkText,
  canonicalize,
  signingInput,
  main,
} from '../vendor-delegation.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VECTORS = join(ROOT, 'vectors');
const CHECKER = join(ROOT, 'vendor-delegation.mjs');

/** Every vector is evaluated at one fixed instant, never the clock. */
const NOW = '2026-09-28T00:00:00Z';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const vectorFiles = (kind) => readdirSync(join(VECTORS, kind)).filter((f) => f.endsWith('.json')).sort();
const codes = (r) => r.errors.map((e) => e.code);

/** A well-formed three-hop chain to mutate in the unit tests. */
function chain() {
  return structuredClone(readJson(join(VECTORS, 'valid', 'three-hop.json')));
}

// ── Vectors ────────────────────────────────────────────────────────────────

/**
 * Every invalid vector is named for the refusal it must produce. A vector this
 * map does not name fails the suite: an unnamed vector is one nobody checks.
 */
const EXPECTED_REFUSAL = {
  'widened-scope.json': 'scope_widened',
  'cap-exceeds-parent.json': 'cap_exceeds_parent',
  'expiry-later-than-parent.json': 'expiry_later_than_parent',
  'agent-root.json': 'agent_root',
  'expired.json': 'expired',
  'float-cap.json': 'cap_not_integer',
  'float-cap-rounds-to-integer.json': 'cap_not_integer',
  'unknown-key.json': 'unknown_key',
  'unknown-grant-key.json': 'unknown_key',
  'enforced-by-missing.json': 'enforced_by_missing',
  'enforced-by-not-https.json': 'enforced_by_not_https',
  'broken-chain.json': 'broken_chain',
  'purpose-widened.json': 'purpose_widened',
};

describe('vectors', () => {
  const valid = vectorFiles('valid');
  const invalid = vectorFiles('invalid');

  test('the required minimum of vectors exists', () => {
    assert.ok(valid.length >= 3, `expected at least 3 valid vectors, found ${valid.length}`);
    assert.ok(invalid.length >= 5, `expected at least 5 invalid vectors, found ${invalid.length}`);
    for (const name of ['single-hop.json', 'three-hop.json', 'with-extension.json']) assert.ok(valid.includes(name), name);
    for (const name of Object.keys(EXPECTED_REFUSAL)) assert.ok(invalid.includes(name), `${name} is named but missing`);
    for (const name of invalid) assert.ok(name in EXPECTED_REFUSAL, `${name} exists but no test names its refusal`);
  });

  for (const name of valid) {
    test(`valid/${name} validates and verifies at ${NOW}`, () => {
      const text = readFileSync(join(VECTORS, 'valid', name), 'utf8');
      const doc = JSON.parse(text);
      assert.deepEqual(validate(doc), { valid: true, errors: [] });
      const r = verifyChain(doc, { now: NOW });
      assert.equal(r.valid, true, JSON.stringify(r.errors));
      assert.ok(r.effective);
      assert.deepEqual(checkText(text, { now: NOW }).valid, true, 'the raw-text path agrees');
    });
  }

  for (const [name, code] of Object.entries(EXPECTED_REFUSAL)) {
    test(`invalid/${name} is refused with ${code}`, () => {
      const text = readFileSync(join(VECTORS, 'invalid', name), 'utf8');
      const r = checkText(text, { now: NOW });
      assert.equal(r.valid, false);
      assert.ok(codes(r).includes(code), `expected ${code}, got ${codes(r).join(', ')}`);
      assert.ok(REFUSALS.includes(code), `${code} is in the published refusal vocabulary`);
    });
  }

  test('the three-hop vector is person → org → agent → session', () => {
    const doc = chain();
    assert.equal(doc.chain.length, 3);
    assert.match(doc.chain[0].issuer, /^person\//);
    assert.match(doc.chain[0].subject, /^org\//);
    assert.match(doc.chain[1].subject, /^agent\//);
    assert.match(doc.chain[2].subject, /^session\//);
  });

  test('the effective grant is the tightest cap and the earliest expiry, held by the leaf', () => {
    const r = verifyChain(chain(), { now: NOW });
    assert.equal(r.effective.root, 'person/example-human');
    assert.equal(r.effective.holder, 'session/2fd4e1c67a2d28fced849ee1bb76e739');
    assert.equal(r.effective.cap, 5000);
    assert.equal(r.effective.expires, '2098-06-29T12:00:00.000Z');
    assert.deepEqual(r.effective.scopes, ['rewards:redeem']);
    assert.deepEqual(r.effective.hops, ['grant/root-0001', 'grant/org-0002', 'grant/session-0003']);
  });
});

// ── Attenuation: a chain only narrows ──────────────────────────────────────

describe('attenuation', () => {
  test('a child may carry the same scopes as its parent, or fewer', () => {
    const doc = chain();
    doc.chain[1].scopes = [...doc.chain[0].scopes];
    doc.chain[2].scopes = ['ledger:read'];
    assert.equal(verifyChain(doc, { now: NOW }).valid, true);
  });

  test('a child scope not held by the parent is refused (scope_widened)', () => {
    const doc = chain();
    doc.chain[2].scopes = ['rewards:redeem', 'rewards:transfer'];
    const r = verifyChain(doc, { now: NOW });
    assert.deepEqual(codes(r), ['scope_widened']);
    assert.equal(r.errors[0].at, 2);
  });

  test('a child cap equal to the parent is fine; one unit more is refused', () => {
    const doc = chain();
    doc.chain[1].cap = doc.chain[0].cap;
    assert.equal(verifyChain(doc, { now: NOW }).valid, true);
    doc.chain[1].cap = doc.chain[0].cap + 1;
    assert.deepEqual(codes(verifyChain(doc, { now: NOW })), ['cap_exceeds_parent']);
  });

  test('a child expiry equal to the parent is fine; one second later is refused', () => {
    const doc = chain();
    doc.chain[1].expires = doc.chain[0].expires;
    assert.equal(verifyChain(doc, { now: NOW }).valid, true);
    doc.chain[1].expires = '2099-01-01T00:00:01Z';
    assert.deepEqual(codes(verifyChain(doc, { now: NOW })), ['expiry_later_than_parent']);
  });

  test('expiry comparison is by instant, not by string: an offset that lands later is refused', () => {
    const doc = chain();
    // 2099-01-01T00:00:00-01:00 is 2099-01-01T01:00:00Z — after the parent.
    doc.chain[1].expires = '2099-01-01T00:00:00-01:00';
    assert.deepEqual(codes(verifyChain(doc, { now: NOW })), ['expiry_later_than_parent']);
  });

  test('purpose may stay the same or narrow by a path segment, never widen or drift', () => {
    const doc = chain();
    doc.chain[1].purpose = 'settlement';
    doc.chain[2].purpose = 'settlement';
    assert.equal(verifyChain(doc, { now: NOW }).valid, true);
    doc.chain[2].purpose = 'settlement/redeem';
    assert.equal(verifyChain(doc, { now: NOW }).valid, true);
    doc.chain[1].purpose = 'settlement/redeem';
    doc.chain[2].purpose = 'settlement';
    assert.deepEqual(codes(verifyChain(doc, { now: NOW })), ['purpose_widened']);
    doc.chain[2].purpose = 'settlements';
    assert.deepEqual(codes(verifyChain(doc, { now: NOW })), ['purpose_widened'], 'a prefix without a slash is a different purpose');
  });

  test('every widening on one hop is reported, not just the first', () => {
    const doc = chain();
    doc.chain[2].scopes = ['rewards:transfer'];
    doc.chain[2].cap = 999999999;
    doc.chain[2].expires = '2099-12-31T00:00:00Z';
    doc.chain[2].purpose = 'anything';
    assert.deepEqual(codes(verifyChain(doc, { now: NOW })).sort(), [
      'cap_exceeds_parent',
      'expiry_later_than_parent',
      'purpose_widened',
      'scope_widened',
    ]);
  });
});

// ── Binding: each hop is issued by the holder above ────────────────────────

describe('chain binding', () => {
  test('a hop whose issuer is not the holder above is refused (broken_chain)', () => {
    const doc = chain();
    doc.chain[2].issuer = 'agent/somebody-else';
    const r = verifyChain(doc, { now: NOW });
    assert.deepEqual(codes(r), ['broken_chain']);
    assert.equal(r.errors[0].at, 2);
  });

  test('the root must be a person or an org: an agent root is refused (agent_root)', () => {
    const doc = chain();
    doc.chain[0].issuer = 'agent/example-org-orchestrator';
    assert.deepEqual(codes(validate(doc)), ['agent_root']);
  });

  test('a session root is refused too (bad_root)', () => {
    const doc = chain();
    doc.chain[0].issuer = 'session/0123456789abcdef0123456789abcdef';
    assert.deepEqual(codes(validate(doc)), ['bad_root']);
  });

  test('an org may root a chain', () => {
    const doc = chain();
    doc.chain.shift();
    assert.equal(verifyChain(doc, { now: NOW }).valid, true);
  });

  test('trustedRoots, when given, pins the root; an empty set trusts nobody', () => {
    assert.equal(verifyChain(chain(), { now: NOW, trustedRoots: ['person/example-human'] }).valid, true);
    const r = verifyChain(chain(), { now: NOW, trustedRoots: [] });
    assert.deepEqual(codes(r), ['untrusted_root']);
    assert.deepEqual(codes(verifyChain(chain(), { now: NOW, trustedRoots: ['person/other'] })), ['untrusted_root']);
  });

  test('ids must be <kind>/<slug>; anything else is refused (bad_id)', () => {
    for (const bad of ['michael', 'Person/michael', 'person/', 'person/With Space', 'user/michael', 'agent:org/name']) {
      const doc = chain();
      doc.chain[1].subject = bad;
      assert.ok(codes(validate(doc)).includes('bad_id'), bad);
    }
  });
});

// ── Time: expiry and revocation ────────────────────────────────────────────

describe('expiry and revocation', () => {
  test('a grant is expired at its own expiry instant, not one second after', () => {
    const doc = chain();
    assert.equal(verifyChain(doc, { now: '2098-06-29T11:59:59Z' }).valid, true);
    const r = verifyChain(doc, { now: '2098-06-29T12:00:00Z' });
    assert.deepEqual(codes(r), ['expired']);
    assert.equal(r.errors[0].at, 2);
  });

  test('an expired ancestor expires the whole chain', () => {
    const doc = chain();
    doc.chain[0].expires = '2026-09-27T00:00:00Z';
    doc.chain[1].expires = '2026-09-27T00:00:00Z';
    doc.chain[2].expires = '2026-09-27T00:00:00Z';
    assert.deepEqual(codes(verifyChain(doc, { now: NOW })), ['expired', 'expired', 'expired']);
  });

  test('now defaults to the clock: a 2099 chain verifies today, a 2020 chain does not', () => {
    assert.equal(verifyChain(chain()).valid, true);
    const doc = readJson(join(VECTORS, 'invalid', 'expired.json'));
    assert.deepEqual(codes(verifyChain(doc)), ['expired']);
  });

  test('now accepts a Date, epoch milliseconds or an ISO string, and refuses anything else', () => {
    assert.equal(verifyChain(chain(), { now: new Date(NOW) }).valid, true);
    assert.equal(verifyChain(chain(), { now: Date.parse(NOW) }).valid, true);
    assert.throws(() => verifyChain(chain(), { now: 'yesterday' }), TypeError);
  });

  test('revocation is immediate: a revoked grant refuses the instant it is in the set', () => {
    const doc = chain();
    assert.equal(verifyChain(doc, { now: NOW, revoked: [] }).valid, true);
    const r = verifyChain(doc, { now: NOW, revoked: ['grant/session-0003'] });
    assert.deepEqual(codes(r), ['revoked']);
    assert.equal(r.errors[0].at, 2);
  });

  test('revocation walks down: revoking the root refuses the chain, named at the root', () => {
    const r = verifyChain(chain(), { now: NOW, revoked: new Set(['grant/root-0001']) });
    assert.deepEqual(codes(r), ['revoked']);
    assert.equal(r.errors[0].at, 0);
  });

  test('every grant carries an expiry; a missing or zoneless one is refused', () => {
    const doc = chain();
    delete doc.chain[1].expires;
    assert.deepEqual(codes(validate(doc)), ['missing_field']);
    const zoneless = chain();
    zoneless.chain[1].expires = '2098-06-30T00:00:00';
    assert.deepEqual(codes(validate(zoneless)), ['bad_expiry']);
    const dateOnly = chain();
    dateOnly.chain[1].expires = '2098-06-30';
    assert.deepEqual(codes(validate(dateOnly)), ['bad_expiry']);
  });
});

// ── Enforcement point ──────────────────────────────────────────────────────

describe('enforcedBy', () => {
  test('a grant with no enforcedBy is refused with its own code', () => {
    const doc = chain();
    delete doc.chain[0].enforcedBy;
    assert.deepEqual(codes(validate(doc)), ['enforced_by_missing']);
  });

  test('http, a bare host, and a non-URL are all refused (enforced_by_not_https)', () => {
    for (const bad of ['http://rails.example/x', 'rails.example/x', 'ftp://rails.example', '', 42]) {
      const doc = chain();
      doc.chain[0].enforcedBy = bad;
      assert.deepEqual(codes(validate(doc)), ['enforced_by_not_https'], String(bad));
    }
  });

  test('hops may name different enforcement points; the leaf\'s is the effective one', () => {
    const doc = chain();
    doc.chain[2].enforcedBy = 'https://other.example/gate';
    const r = verifyChain(doc, { now: NOW });
    assert.equal(r.valid, true);
    assert.equal(r.effective.enforcedBy, 'https://other.example/gate');
  });
});

// ── Cap: Minor integer units ───────────────────────────────────────────────

describe('cap', () => {
  test('a float cap is refused (cap_not_integer)', () => {
    for (const bad of [2500.5, 0.1, Number.NaN, Number.POSITIVE_INFINITY, '2500', 2 ** 53]) {
      const doc = chain();
      doc.chain[0].cap = bad;
      assert.deepEqual(codes(validate(doc)), ['cap_not_integer'], String(bad));
    }
  });

  test('a negative cap is refused (cap_negative); zero is a cap', () => {
    const doc = chain();
    doc.chain[2].cap = -1;
    assert.deepEqual(codes(validate(doc)), ['cap_negative']);
    doc.chain[2].cap = 0;
    assert.equal(verifyChain(doc, { now: NOW }).valid, true);
  });

  test('a cap literal the parser would round (2500.0, 25e2) is refused from the raw text', () => {
    const base = readFileSync(join(VECTORS, 'valid', 'single-hop.json'), 'utf8');
    assert.equal(checkText(base, { now: NOW }).valid, true);
    for (const literal of ['2500.0', '25e2', '2.5E3', '2500.']) {
      const r = checkText(base.replace('"cap": 250000', `"cap": ${literal}`), { now: NOW });
      assert.deepEqual(codes(r), ['cap_not_integer'], literal);
    }
  });

  test('the parsed form of 2500.0 is indistinguishable from 2500, which is why the text check exists', () => {
    const doc = readJson(join(VECTORS, 'invalid', 'float-cap-rounds-to-integer.json'));
    assert.equal(doc.chain[0].cap, 2500);
    assert.equal(validate(doc).valid, true, 'after parsing the document is valid');
  });
});

// ── Shape: the parser refuses, it does not guess ───────────────────────────

describe('document shape', () => {
  test('a document is an object with contract and chain', () => {
    for (const bad of [null, [], 'x', 42]) assert.deepEqual(codes(validate(bad)), ['not_an_object']);
    assert.deepEqual(codes(validate({ chain: [] })), ['missing_field', 'empty_chain']);
    assert.deepEqual(codes(validate({ contract: CONTRACT })), ['missing_field']);
    assert.deepEqual(codes(validate({ contract: 'delegation/2', chain: [] })), ['bad_contract', 'empty_chain']);
    assert.deepEqual(codes(validate({ contract: CONTRACT, chain: {} })), ['bad_type']);
  });

  test('an unknown top-level key is refused; an x- key is carried', () => {
    const doc = chain();
    doc.issuedAt = NOW;
    assert.deepEqual(codes(validate(doc)), ['unknown_key']);
    const ext = chain();
    ext['x-issued-at'] = NOW;
    assert.equal(validate(ext).valid, true);
  });

  test('an unknown grant key is refused, including any spelling of expiry other than `expires`', () => {
    for (const key of ['expiry', 'exp', 'expiresAt', 'ttl', 'limit', 'holder']) {
      const doc = chain();
      doc.chain[1][key] = 'anything';
      const r = validate(doc);
      assert.deepEqual(codes(r), ['unknown_key'], key);
      assert.equal(r.errors[0].path, `chain[1].${key}`);
    }
    const ext = chain();
    ext.chain[1]['x-anything'] = { nested: true };
    assert.equal(validate(ext).valid, true);
  });

  test('every grant key is required and a missing one is named', () => {
    for (const key of GRANT_KEYS) {
      const doc = chain();
      delete doc.chain[1][key];
      const r = validate(doc);
      assert.equal(r.valid, false, key);
      assert.equal(r.errors[0].path, `chain[1].${key}`);
    }
  });

  test('a grant with no scopes, or duplicate scopes, is refused', () => {
    const doc = chain();
    doc.chain[2].scopes = [];
    assert.deepEqual(codes(validate(doc)), ['empty_scopes']);
    doc.chain[2].scopes = ['rewards:redeem', 'rewards:redeem'];
    assert.deepEqual(codes(validate(doc)), ['duplicate_scope']);
    doc.chain[2].scopes = 'rewards:redeem';
    assert.deepEqual(codes(validate(doc)), ['bad_type']);
  });

  test('a grant id must be unique within the chain', () => {
    const doc = chain();
    doc.chain[2].id = doc.chain[0].id;
    assert.deepEqual(codes(validate(doc)), ['duplicate_id']);
  });

  test('signature is null or { alg, value, kid? } and nothing else', () => {
    const ok = chain();
    ok.chain[0].signature = { alg: 'EdDSA', value: 'x' };
    assert.equal(validate(ok).valid, true);
    for (const bad of ['sig', {}, { alg: 'EdDSA' }, { alg: 'EdDSA', value: '' }, { alg: 'EdDSA', value: 'x', extra: 1 }, undefined]) {
      const doc = chain();
      doc.chain[0].signature = bad;
      assert.equal(validate(doc).valid, false, JSON.stringify(bad));
    }
  });

  test('a chain is reported signed only when every grant carries a signature', () => {
    assert.equal(verifyChain(chain(), { now: NOW }).signed, false);
    const ext = readJson(join(VECTORS, 'valid', 'with-extension.json'));
    assert.equal(verifyChain(ext, { now: NOW }).signed, true);
    ext.chain[1].signature = null;
    assert.equal(verifyChain(ext, { now: NOW }).signed, false);
  });

  test('verifyChain refuses a structurally invalid document before walking it', () => {
    const doc = chain();
    doc.chain[0].issuer = 'agent/x';
    doc.chain[2].cap = 999999999;
    assert.deepEqual(codes(verifyChain(doc, { now: NOW })), ['agent_root']);
  });
});

// ── Signing input ──────────────────────────────────────────────────────────

describe('signing input', () => {
  test('canonical JSON sorts keys at every level and keeps array order', () => {
    assert.equal(canonicalize({ b: [3, { z: 1, a: 2 }], a: 'x' }), '{"a":"x","b":[3,{"a":2,"z":1}]}');
    assert.equal(canonicalize(null), 'null');
  });

  test('the signing input is the canonical grant without `signature`, and includes x- keys', () => {
    const g = readJson(join(VECTORS, 'valid', 'with-extension.json')).chain[0];
    const input = signingInput(g);
    assert.ok(!input.includes('"signature"'));
    assert.ok(input.includes('"x-issued-via":"example-console"'));
    assert.equal(input, canonicalize({ ...g, signature: undefined }).replace(',"signature":undefined', ''));
    const unsigned = { ...g, signature: null };
    const signed = { ...g, signature: { alg: 'EdDSA', value: 'abc' } };
    assert.equal(signingInput(unsigned), signingInput(signed), 'the signature never signs itself');
  });
});

// ── Schema and checker cannot drift ────────────────────────────────────────

describe('schema', () => {
  const schema = readJson(join(ROOT, 'schema', 'delegation-1.json'));

  test('is draft 2020-12 and refuses unknown keys except x- at both levels', () => {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(Object.keys(schema.patternProperties), ['^x-']);
    assert.equal(schema.$defs.grant.additionalProperties, false);
    assert.deepEqual(Object.keys(schema.$defs.grant.patternProperties), ['^x-']);
  });

  test('its required keys are the checker\'s, in both directions', () => {
    assert.deepEqual([...schema.required].sort(), [...DOCUMENT_KEYS].sort());
    assert.deepEqual([...schema.$defs.grant.required].sort(), [...GRANT_KEYS].sort());
    assert.deepEqual(Object.keys(schema.$defs.grant.properties).sort(), [...GRANT_KEYS].sort());
    assert.equal(schema.properties.contract.const, CONTRACT);
  });

  test('cap is an integer with a floor of zero; enforcedBy is https; the root is person or org', () => {
    assert.equal(schema.$defs.grant.properties.cap.type, 'integer');
    assert.equal(schema.$defs.grant.properties.cap.minimum, 0);
    assert.equal(schema.$defs.grant.properties.enforcedBy.pattern, '^https://');
    assert.match(schema.$defs.rootId.pattern, /^\^\(person\|org\)/);
  });
});

// ── CLI ────────────────────────────────────────────────────────────────────

describe('cli', () => {
  const run = (...args) => spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8', cwd: ROOT });

  test('check on a valid vector exits 0 and prints the effective grant', () => {
    const r = run('check', 'vectors/valid/three-hop.json');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /delegation\/1 ok: 3 hops, person\/example-human → session\//);
    assert.match(r.stdout, /cap {6}5000 minor units/);
    assert.match(r.stdout, /signed {3}no/);
  });

  test('check on an invalid vector exits 1 and names the refusal', () => {
    const r = run('check', 'vectors/invalid/widened-scope.json');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /REFUSED: 1 error/);
    assert.match(r.stdout, /scope_widened\s+chain\[1\]\.scopes/);
  });

  test('--now evaluates at an instant; --json prints the result', () => {
    const expired = run('check', 'vectors/valid/three-hop.json', '--now', '2099-06-01T00:00:00Z');
    assert.equal(expired.status, 1);
    const json = run('check', 'vectors/valid/single-hop.json', '--json');
    assert.equal(json.status, 0);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.effective.holder, 'agent/example-org-settlement');
  });

  test('usage errors and unreadable files exit 2, never 0', () => {
    assert.equal(run().status, 2);
    assert.equal(run('verify', 'x.json').status, 2);
    assert.equal(run('check').status, 2);
    assert.equal(run('check', 'vectors/does-not-exist.json').status, 2);
    assert.equal(run('check', 'vectors/valid/single-hop.json', '--now', 'soon').status, 2);
    assert.equal(run('check', 'vectors/valid/single-hop.json', '--bogus').status, 2);
  });

  test('main() is callable in-process with injected io', () => {
    const out = [];
    const code = main(['check', join(VECTORS, 'invalid', 'agent-root.json')], { stdout: (s) => out.push(s), stderr: (s) => out.push(s) });
    assert.equal(code, 1);
    assert.ok(out.some((l) => l.includes('agent_root')));
  });
});

// ── The documents say what the code does ───────────────────────────────────

describe('documentation', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const spec = readFileSync(join(ROOT, 'SPEC.md'), 'utf8');

  test('the README quick start names a command that works', () => {
    const m = readme.match(/node vendor-delegation\.mjs check (vectors\/valid\/[a-z-]+\.json)/);
    assert.ok(m, 'README quick start shows the check command');
    assert.equal(spawnSync(process.execPath, [CHECKER, 'check', m[1]], { cwd: ROOT }).status, 0);
  });

  test('the README ends with the licence line and no LICENSE file exists', () => {
    const last = readme.trimEnd().split('\n').pop();
    assert.equal(last, 'Licence: to be declared at launch. The estate licence register in flashyos governs; this repository is not yet open-sourced.');
    assert.ok(!readdirSync(ROOT).some((f) => /^LICENSE/i.test(f)));
  });

  test('both documents carry the draft status and the contract name', () => {
    assert.match(readme, /Status: draft/);
    assert.match(spec, /Status: draft/);
    assert.match(spec, /`delegation\/1`/);
  });

  test('every refusal the checker can emit is documented in SPEC.md', () => {
    for (const code of REFUSALS) assert.ok(spec.includes(`\`${code}\``), `SPEC.md documents ${code}`);
  });

  test('every grant field is in the SPEC field-rules table', () => {
    for (const key of GRANT_KEYS) assert.ok(new RegExp(`^\\| \`${key}\``, 'm').test(spec), `SPEC.md has a row for ${key}`);
  });
});
