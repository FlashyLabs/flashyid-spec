// delegation/1 — the reference checker, vendored.
//
// Copy this one file anywhere. It imports only `node:` builtins, so it runs
// with nothing installed:
//
//   node vendor-delegation.mjs check vectors/valid/three-hop.json
//   node vendor-delegation.mjs check some-chain.json --now 2026-09-28T00:00:00Z
//   node vendor-delegation.mjs check some-chain.json --json
//
// Exit code is 0 only if the document validates AND the chain verifies at the
// evaluated time, so it drops into CI as-is. 1 on refusal, 2 on usage or an
// unreadable file.
//
// THE RULE, in one line: a chain only narrows. Each grant is issued by the
// holder of the grant above it and may carry a subset of its scopes, a cap no
// higher, an expiry no later, and the same or a narrower purpose. The root is
// a person or an organisation, never a machine. Anything else is refused with a
// named reason — never clamped, never guessed.
//
// What this file does NOT do: verify a signature. delegation/1 defines what is
// signed (`signingInput`) and mandates no algorithm and no key distribution;
// those are the implementation's (FlashyLabs/flashyid). A document whose every
// grant carries `signature: null` is reported `signed: false`, and a stranger
// reading the result knows exactly which half was checked.
//
// This file must stay byte-identical across every copy. Changing it in one
// place and not another is how a vendored file fails: not by breaking, but by
// quietly disagreeing about the one field somebody just changed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CONTRACT = 'delegation/1';

/** Top-level keys a document may carry, besides `x-*`. */
export const DOCUMENT_KEYS = Object.freeze(['contract', 'chain']);

/** Keys a grant may carry, besides `x-*`. Every one is required. */
export const GRANT_KEYS = Object.freeze([
  'id',
  'issuer',
  'subject',
  'scopes',
  'cap',
  'expires',
  'purpose',
  'enforcedBy',
  'signature',
]);

/** Principal kinds that may sit at the root of a chain. */
export const ROOT_KINDS = Object.freeze(['person', 'org']);

/** Every principal kind an id may name. */
export const ID_KINDS = Object.freeze(['person', 'org', 'agent', 'session']);

/**
 * The refusal vocabulary. Every refusal names one of these; the code is part
 * of the published contract and a relying party may branch on it.
 */
export const REFUSALS = Object.freeze([
  'not_an_object',
  'unknown_key',
  'missing_field',
  'bad_type',
  'bad_contract',
  'empty_chain',
  'bad_id',
  'duplicate_id',
  'agent_root',
  'bad_root',
  'empty_scopes',
  'duplicate_scope',
  'cap_not_integer',
  'cap_negative',
  'bad_expiry',
  'bad_purpose',
  'enforced_by_missing',
  'enforced_by_not_https',
  'bad_signature',
  'broken_chain',
  'scope_widened',
  'cap_exceeds_parent',
  'expiry_later_than_parent',
  'purpose_widened',
  'expired',
  'revoked',
  'untrusted_root',
]);

const SLUG = '[a-z0-9][a-z0-9._-]*';
const ID = new RegExp(`^(${ID_KINDS.join('|')})/${SLUG}$`);
const PURPOSE = new RegExp(`^${SLUG}(/${SLUG})*$`);
// ISO 8601, second precision or finer, with an explicit zone. A timestamp with
// no zone is a guess about where the issuer was standing.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
// A `cap` literal with a fraction or an exponent in the RAW TEXT. JSON.parse
// turns `2500.0` into the integer 2500, so a parsed document cannot tell the
// two apart; the CLI reads the bytes first and refuses what the parser would
// have quietly rounded.
const CAP_LITERAL_NOT_INTEGER = /"cap"\s*:\s*-?\d+(\.\d*|[eE][+-]?\d+)/;

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isExtension = (key) => key.startsWith('x-');

/**
 * JSON with keys sorted at every level; arrays keep their order. This is the
 * canonical form the signing input is taken over. Byte-identical to the
 * estate's other sealers, for the same reason: a drift here makes honest
 * signatures look forged.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The bytes a grant's signature is taken over: the canonical JSON of the grant
 * with `signature` removed. Extension (`x-`) keys ARE signed — an issuer vouches
 * for everything it wrote.
 *
 * @param {Record<string, unknown>} grant
 * @returns {string}
 */
export function signingInput(grant) {
  const { signature: _omitted, ...rest } = grant;
  return canonicalize(rest);
}

function err(errors, code, path, message, at) {
  const e = { code, path, message };
  if (at !== undefined) e.at = at;
  errors.push(e);
}

function kindOf(id) {
  const slash = id.indexOf('/');
  return slash === -1 ? '' : id.slice(0, slash);
}

/**
 * Is `child` a narrowing of `parent`? Equal, or parent followed by `/` and
 * more. `settlement/redeem` narrows `settlement`; `settlements` does not.
 */
function purposeWithin(child, parent) {
  return child === parent || child.startsWith(`${parent}/`);
}

function checkGrant(grant, i, errors) {
  const path = `chain[${i}]`;
  if (!isPlainObject(grant)) {
    err(errors, 'bad_type', path, 'a grant must be an object', i);
    return false;
  }
  let ok = true;
  for (const key of Object.keys(grant)) {
    if (!GRANT_KEYS.includes(key) && !isExtension(key)) {
      err(errors, 'unknown_key', `${path}.${key}`, `unknown key "${key}" (extensions must be x- prefixed)`, i);
      ok = false;
    }
  }
  for (const key of GRANT_KEYS) {
    if (!(key in grant)) {
      const code = key === 'enforcedBy' ? 'enforced_by_missing' : 'missing_field';
      err(errors, code, `${path}.${key}`, `missing required field "${key}"`, i);
      ok = false;
    }
  }
  if (!ok) return false;

  if (typeof grant.id !== 'string' || grant.id.length === 0) {
    err(errors, 'bad_type', `${path}.id`, 'id must be a non-empty string', i);
    ok = false;
  }
  for (const field of ['issuer', 'subject']) {
    const v = grant[field];
    if (typeof v !== 'string' || !ID.test(v)) {
      err(errors, 'bad_id', `${path}.${field}`, `${field} must be <kind>/<slug> with kind one of ${ID_KINDS.join(', ')}`, i);
      ok = false;
    }
  }
  if (!Array.isArray(grant.scopes) || grant.scopes.some((s) => typeof s !== 'string' || s.length === 0)) {
    err(errors, 'bad_type', `${path}.scopes`, 'scopes must be an array of non-empty strings', i);
    ok = false;
  } else if (grant.scopes.length === 0) {
    err(errors, 'empty_scopes', `${path}.scopes`, 'a grant with no scopes grants nothing and is refused', i);
    ok = false;
  } else if (new Set(grant.scopes).size !== grant.scopes.length) {
    err(errors, 'duplicate_scope', `${path}.scopes`, 'scopes must be unique', i);
    ok = false;
  }
  if (typeof grant.cap !== 'number' || !Number.isSafeInteger(grant.cap)) {
    err(errors, 'cap_not_integer', `${path}.cap`, 'cap must be an integer count of minor units, never a float', i);
    ok = false;
  } else if (grant.cap < 0) {
    err(errors, 'cap_negative', `${path}.cap`, 'cap must be zero or more', i);
    ok = false;
  }
  if (typeof grant.expires !== 'string' || !ISO.test(grant.expires) || Number.isNaN(Date.parse(grant.expires))) {
    err(errors, 'bad_expiry', `${path}.expires`, 'expires must be an ISO 8601 timestamp with an explicit zone', i);
    ok = false;
  }
  if (typeof grant.purpose !== 'string' || !PURPOSE.test(grant.purpose)) {
    err(errors, 'bad_purpose', `${path}.purpose`, 'purpose must be a slug path such as "settlement" or "settlement/redeem"', i);
    ok = false;
  }
  if (typeof grant.enforcedBy !== 'string') {
    err(errors, 'enforced_by_not_https', `${path}.enforcedBy`, 'enforcedBy must be an https URL', i);
    ok = false;
  } else {
    let url = null;
    try {
      url = new URL(grant.enforcedBy);
    } catch {
      url = null;
    }
    if (!url || url.protocol !== 'https:') {
      err(errors, 'enforced_by_not_https', `${path}.enforcedBy`, 'enforcedBy must be an https URL', i);
      ok = false;
    }
  }
  const sig = grant.signature;
  const sigOk =
    sig === null ||
    (isPlainObject(sig) &&
      Object.keys(sig).every((k) => k === 'alg' || k === 'value' || k === 'kid') &&
      typeof sig.alg === 'string' &&
      sig.alg.length > 0 &&
      typeof sig.value === 'string' &&
      sig.value.length > 0 &&
      (sig.kid === undefined || typeof sig.kid === 'string'));
  if (!sigOk) {
    err(errors, 'bad_signature', `${path}.signature`, 'signature must be null (unsigned) or { alg, value, kid? }', i);
    ok = false;
  }
  return ok;
}

/**
 * Structural validation of a delegation/1 document: shape, types, id forms,
 * the root rule, https enforcement points, integer caps. Time-independent.
 * Equivalent to schema/delegation-1.json plus the rules a schema cannot state.
 *
 * @param {unknown} doc
 * @returns {{ valid: boolean, errors: Array<{code: string, path: string, message: string, at?: number}> }}
 */
export function validate(doc) {
  const errors = [];
  if (!isPlainObject(doc)) {
    err(errors, 'not_an_object', '$', 'a delegation/1 document is a JSON object');
    return { valid: false, errors };
  }
  for (const key of Object.keys(doc)) {
    if (!DOCUMENT_KEYS.includes(key) && !isExtension(key)) {
      err(errors, 'unknown_key', `$.${key}`, `unknown key "${key}" (extensions must be x- prefixed)`);
    }
  }
  if (!('contract' in doc)) err(errors, 'missing_field', '$.contract', 'missing required field "contract"');
  else if (doc.contract !== CONTRACT) err(errors, 'bad_contract', '$.contract', `contract must be "${CONTRACT}"`);

  if (!('chain' in doc)) {
    err(errors, 'missing_field', '$.chain', 'missing required field "chain"');
    return { valid: false, errors };
  }
  if (!Array.isArray(doc.chain)) {
    err(errors, 'bad_type', '$.chain', 'chain must be an array of grants, root first');
    return { valid: false, errors };
  }
  if (doc.chain.length === 0) {
    err(errors, 'empty_chain', '$.chain', 'a chain with no grants delegates nothing and is refused');
    return { valid: false, errors };
  }

  const grantsOk = doc.chain.map((g, i) => checkGrant(g, i, errors));

  if (grantsOk[0]) {
    const kind = kindOf(doc.chain[0].issuer);
    if (kind === 'agent') {
      err(errors, 'agent_root', 'chain[0].issuer', 'a chain roots at a person or an organisation, never an agent', 0);
    } else if (!ROOT_KINDS.includes(kind)) {
      err(errors, 'bad_root', 'chain[0].issuer', `a chain roots at one of ${ROOT_KINDS.join(', ')}`, 0);
    }
  }

  const seen = new Set();
  doc.chain.forEach((g, i) => {
    if (!grantsOk[i]) return;
    if (seen.has(g.id)) err(errors, 'duplicate_id', `chain[${i}].id`, `grant id "${g.id}" appears twice`, i);
    seen.add(g.id);
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Validate, then walk the chain root → leaf and refuse any hop that does not
 * attenuate. Time is an argument, never a clock this function reads on its
 * own, so an auditor re-checking a past decision evaluates it at the time it
 * was made.
 *
 * @param {unknown} doc
 * @param {{ now?: number | string | Date, revoked?: Iterable<string>, trustedRoots?: Iterable<string> }} [opts]
 * @returns {{ valid: boolean, errors: Array<{code: string, path: string, message: string, at?: number}>, signed?: boolean, effective?: object }}
 */
export function verifyChain(doc, opts = {}) {
  const structural = validate(doc);
  if (!structural.valid) return structural;

  const nowMs = toMs(opts.now === undefined ? Date.now() : opts.now);
  if (Number.isNaN(nowMs)) throw new TypeError('verifyChain: `now` must be a Date, epoch milliseconds, or an ISO string');
  const revoked = new Set(opts.revoked ?? []);
  const errors = [];
  const chain = doc.chain;

  if (opts.trustedRoots !== undefined) {
    const trusted = new Set(opts.trustedRoots);
    if (!trusted.has(chain[0].issuer)) {
      err(errors, 'untrusted_root', 'chain[0].issuer', `chain roots at ${chain[0].issuer}, which this enforcement point does not accept`, 0);
    }
  }

  let effectiveCap = chain[0].cap;
  let effectiveExpiresMs = Date.parse(chain[0].expires);

  for (let i = 0; i < chain.length; i++) {
    const g = chain[i];
    const path = `chain[${i}]`;
    // Revocation walks down: a revoked grant kills everything delegated from
    // it, and it is checked ancestor-first so the refusal names the highest.
    if (revoked.has(g.id)) err(errors, 'revoked', `${path}.id`, `grant "${g.id}" is revoked`, i);
    const expMs = Date.parse(g.expires);
    if (expMs <= nowMs) err(errors, 'expired', `${path}.expires`, `grant expired at ${g.expires}`, i);

    if (i > 0) {
      const p = chain[i - 1];
      if (g.issuer !== p.subject) {
        err(errors, 'broken_chain', `${path}.issuer`, `issuer ${g.issuer} is not the holder of the grant above (${p.subject})`, i);
      }
      const parentScopes = new Set(p.scopes);
      const extra = g.scopes.filter((s) => !parentScopes.has(s));
      if (extra.length) err(errors, 'scope_widened', `${path}.scopes`, `scopes not held by the parent: ${extra.join(', ')}`, i);
      if (g.cap > p.cap) err(errors, 'cap_exceeds_parent', `${path}.cap`, `cap ${g.cap} exceeds the parent's ${p.cap}`, i);
      if (expMs > Date.parse(p.expires)) {
        err(errors, 'expiry_later_than_parent', `${path}.expires`, `expires ${g.expires} is later than the parent's ${p.expires}`, i);
      }
      if (!purposeWithin(g.purpose, p.purpose)) {
        err(errors, 'purpose_widened', `${path}.purpose`, `purpose "${g.purpose}" is not the parent's "${p.purpose}" or narrower`, i);
      }
      effectiveCap = Math.min(effectiveCap, g.cap);
      effectiveExpiresMs = Math.min(effectiveExpiresMs, expMs);
    }
  }

  const signed = chain.every((g) => g.signature !== null);
  if (errors.length) return { valid: false, errors, signed };

  const leaf = chain[chain.length - 1];
  return {
    valid: true,
    errors,
    signed,
    effective: {
      root: chain[0].issuer,
      holder: leaf.subject,
      scopes: [...leaf.scopes],
      cap: effectiveCap,
      expires: new Date(effectiveExpiresMs).toISOString(),
      purpose: leaf.purpose,
      enforcedBy: leaf.enforcedBy,
      hops: chain.map((g) => g.id),
    },
  };
}

/**
 * Check a document from its raw bytes: refuses a `cap` literal the parser
 * would have rounded, then parses and verifies. This is what the CLI runs.
 *
 * @param {string} text
 * @param {Parameters<typeof verifyChain>[1]} [opts]
 */
export function checkText(text, opts = {}) {
  const m = CAP_LITERAL_NOT_INTEGER.exec(text);
  if (m) {
    return {
      valid: false,
      errors: [{ code: 'cap_not_integer', path: '$', message: `cap literal ${m[0].split(':')[1].trim()} is not an integer` }],
    };
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { valid: false, errors: [{ code: 'bad_type', path: '$', message: `not JSON: ${e.message}` }] };
  }
  return verifyChain(doc, opts);
}

function toMs(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number') return now;
  if (typeof now === 'string') return Date.parse(now);
  return Number.NaN;
}

const USAGE = `usage: node vendor-delegation.mjs check <file.json> [--now <iso>] [--json]

  check   validate the document and verify the chain root → leaf
  --now   evaluate expiry at this instant instead of the clock
  --json  print the full result as JSON

exit 0 on a valid chain, 1 on refusal, 2 on usage or an unreadable file`;

/**
 * @param {string[]} argv
 * @param {{ stdout: (s: string) => void, stderr: (s: string) => void }} io
 * @returns {number} exit code
 */
export function main(argv, io = { stdout: (s) => process.stdout.write(`${s}\n`), stderr: (s) => process.stderr.write(`${s}\n`) }) {
  const [command, ...rest] = argv;
  if (command !== 'check') {
    io.stderr(USAGE);
    return 2;
  }
  let file = null;
  let now;
  let json = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--json') json = true;
    else if (a === '--now') {
      now = rest[++i];
      if (now === undefined || Number.isNaN(Date.parse(now))) {
        io.stderr('--now needs an ISO 8601 instant');
        return 2;
      }
    } else if (a.startsWith('--')) {
      io.stderr(`unknown option ${a}\n${USAGE}`);
      return 2;
    } else if (file === null) file = a;
    else {
      io.stderr(USAGE);
      return 2;
    }
  }
  if (file === null) {
    io.stderr(USAGE);
    return 2;
  }
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    io.stderr(`cannot read ${file}: ${e.message}`);
    return 2;
  }
  const result = checkText(text, now === undefined ? {} : { now });
  if (json) {
    io.stdout(JSON.stringify(result, null, 2));
  } else if (result.valid) {
    const e = result.effective;
    io.stdout(`${CONTRACT} ok: ${e.hops.length} hop${e.hops.length === 1 ? '' : 's'}, ${e.root} → ${e.holder}`);
    io.stdout(`  scopes   ${e.scopes.join(' ')}`);
    io.stdout(`  cap      ${e.cap} minor units (the chain's tightest)`);
    io.stdout(`  expires  ${e.expires} (the chain's earliest)`);
    io.stdout(`  purpose  ${e.purpose}`);
    io.stdout(`  enforced ${e.enforcedBy}`);
    io.stdout(`  signed   ${result.signed ? 'yes (not verified here: see SPEC.md, Verification)' : 'no — structural check only'}`);
  } else {
    io.stdout(`${CONTRACT} REFUSED: ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}`);
    for (const e of result.errors) io.stdout(`  ${e.code.padEnd(26)} ${e.path}  ${e.message}`);
  }
  return result.valid ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
