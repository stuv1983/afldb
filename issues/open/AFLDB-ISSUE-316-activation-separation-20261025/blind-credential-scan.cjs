// Later repository audit tooling. Never an original execution artefact.
// Only PASS/FAIL and the non-secret candidate inventory are persisted.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const auditPath = path.join(__dirname, 'IGNORED-U3-ADMISSION.json');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const insist = (ok, code) => { if (!ok) throw new Error(code); };
function main() {
  const auditBytes = fs.readFileSync(auditPath);
  const audit = JSON.parse(auditBytes);
  const eligible = audit.entries.filter(e => e.disposition === 'ELIGIBLE_PENDING_CREDENTIAL_GATE');
  insist(eligible.length === 42 && audit.entries.filter(e => e.disposition === 'EXCLUDED').length === 20,
    'ADMISSION_COUNTS_CHANGED');
  const inventory = eligible.map(e => {
    const bytes = fs.readFileSync(path.join(root, e.path));
    insist(sha(bytes) === e.actual_sha256 && e.hash_verification.startsWith('PASS') && e.reason,
      'CANDIDATE_HASH_OR_REASON_CHANGED');
    const narrativeReference = 'issues/open/AFLDB-ISSUE-316-u3-correction-20261024/METADATA-REPAIR-V5-RECORD.md';
    insist(e.references.length || (e.inclusion_criteria.includes(3) &&
      /\/metadata-repair-v5-discovery\/discovery\.(?:stdout|stderr)\.log$/.test(e.path) &&
      fs.readFileSync(path.join(root, narrativeReference), 'utf8').includes('`metadata-repair-v5-discovery/`')),
      'INCLUSION_REFERENCE_NOT_VERIFIED');
    insist(e.expected_sha256.every(h => h === sha(bytes)), 'CANDIDATE_EXPECTED_HASH_CHANGED');
    for (const ref of e.references) insist(fs.existsSync(path.join(root, ref.source)), 'REFERENCE_MISSING');
    return { path: e.path, inclusion_reason: e.reason, size: bytes.length, sha256: sha(bytes),
      historical_references: e.references,
      ...(e.references.length ? {} : { canonical_narrative_reference: narrativeReference,
        historical_pin: 'None: original-byte hash recaptured; prior Git materialisation proof retained' }), bytes };
  });
  // Match patterns without ever echoing the matching content.
  const patterns = [
    /postgres(?:ql)?:\/\/[^\s/@]+:[^\s@]+@/i,
    /\bPGPASSWORD\s*=\s*[^\s'"$]/i,
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{20,})\b/,
    /\b(?:password|passwd|secret|access_token|api_key)\s*[=:]\s*["']?[^\s"'${}]{8,}/i
  ];
  insist(inventory.every(e => !patterns.some(re => re.test(e.bytes.toString('utf8')))),
    'STRUCTURAL_CREDENTIAL_SCAN_FAIL');
  const runtime = JSON.parse(fs.readFileSync(path.join(root,
    'issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5/runtime.json')));
  insist(sha(fs.readFileSync(runtime.ssh.path)) === runtime.ssh.sha256, 'SSH_RUNTIME_PIN_CHANGED');
  const key = crypto.randomBytes(32);
  // Read only the already-authorised protected file. No DB connection or census.
  // The key travels solely over SSH stdin; the credential never leaves the host.
  const remote = `set +x\n/usr/bin/python3 - <<'I316_BLIND_PY'\n` +
`import os, stat, re, json, hmac, hashlib, urllib.parse, sys
try:
    key=bytes.fromhex('${key.toString('hex')}')
    fd=os.open('/home/arm/projects/afldb/.env', os.O_RDONLY | os.O_NOFOLLOW)
    st=os.fstat(fd)
    assert stat.S_ISREG(st.st_mode) and stat.S_IMODE(st.st_mode)==0o600 and st.st_uid==os.getuid()
    with os.fdopen(fd, 'r') as f: rows=[s.rstrip('\\n') for s in f if s.startswith('AFLDB_PROD_DATABASE_URL=')]
    assert len(rows)==1
    dsn=rows[0].split('=',1)[1]
    if dsn.startswith('"') and dsn.endswith('"'): dsn=dsn[1:-1]
    assert '\\r' not in dsn and '\\\\' not in dsn
    m=re.fullmatch(r'postgres(?:ql)?://afldb_owner:([^@/?#]+)@localhost:5432/afldb_prod',dsn)
    assert m is not None
    encoded=m.group(1).encode('ascii')
    raw=urllib.parse.unquote_to_bytes(m.group(1))
    assert raw and not re.search(rb'%(?![0-9A-Fa-f]{2})',encoded)
    variants={raw, encoded, urllib.parse.quote_from_bytes(raw,safe='').encode('ascii'),
      urllib.parse.quote_from_bytes(raw,safe="~!*'()-._").encode('ascii')}
    variants |= {re.sub(rb'%[0-9A-Fa-f]{2}',lambda m:m.group(0).lower(),s) for s in list(variants)}
    print(json.dumps([{'length':len(s),'hmac':hmac.new(key,s,hashlib.sha256).hexdigest()} for s in variants]))
except BaseException:
    print('BLIND_REMOTE_FAIL',file=sys.stderr)
    sys.exit(1)
I316_BLIND_PY\n`;
  let result;
  try {
    result = spawnSync(runtime.ssh.path, ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
      'afldb', 'bash', '-s'], { input: remote, timeout: 120000, maxBuffer: 65536 });
    insist(result.status === 0 && !result.error, 'BLIND_REMOTE_UNAVAILABLE');
    const comparisons = JSON.parse(result.stdout.toString('utf8'));
    insist(Array.isArray(comparisons) && comparisons.length >= 1 && comparisons.every(v =>
      Number.isSafeInteger(v.length) && v.length > 0 && /^[0-9a-f]{64}$/.test(v.hmac)), 'BLIND_RESPONSE_INVALID');
    for (const file of inventory) {
      for (const v of comparisons) {
        const expected = Buffer.from(v.hmac, 'hex');
        for (let start = 0; start + v.length <= file.bytes.length; start++) {
          const actual = crypto.createHmac('sha256', key).update(file.bytes.subarray(start, start + v.length)).digest();
          insist(!crypto.timingSafeEqual(actual, expected), 'PRODUCTION_CREDENTIAL_EXACT_BLIND_SCAN_FAIL_STOP');
        }
        expected.fill(0);
      }
    }
    comparisons.forEach(v => { v.hmac = ''; v.length = 0; });
  } finally {
    key.fill(0);
    if (result?.stdout) result.stdout.fill(0);
    if (result?.stderr) result.stderr.fill(0);
  }
  // Recheck on completion to bind the PASS to the exact inventory scanned.
  insist(sha(fs.readFileSync(auditPath)) === sha(auditBytes), 'ADMISSION_LIST_CHANGED_DURING_SCAN');
  for (const file of inventory) insist(sha(fs.readFileSync(path.join(root, file.path))) === file.sha256,
    'CANDIDATE_CHANGED_DURING_SCAN');
  const retained = inventory.map(({ bytes, ...entry }) => ({ ...entry,
    credential_scan: 'PRODUCTION_CREDENTIAL_EXACT_BLIND_SCAN=PASS', structural_scan: 'PASS' }));
  const record = {
    classification: 'Later admission and credential audit; not historical execution evidence',
    generated_at: new Date().toISOString(), implementation_candidate: 'c438f8449e65c28cf9f00879aaa045131b5f0d3a',
    source_admission_audit: path.relative(root, auditPath).replaceAll('\\', '/'),
    source_admission_audit_sha256: sha(auditBytes),
    candidate_inventory_sha256: sha(Buffer.from(JSON.stringify(retained))),
    result: 'PRODUCTION_CREDENTIAL_EXACT_BLIND_SCAN=PASS', structural_scan: 'PASS',
    method: 'Fresh random HMAC-SHA256 key via authorised SSH stdin. Protected production DSN read only on host; raw and URI-encoded password variants compared against every byte substring of corresponding lengths in every candidate. No DB connection. Key, HMACs and lengths transient and not retained.',
    scanner_sha256: sha(fs.readFileSync(__filename)), admitted_candidates: 42, excluded: 20,
    force_add_performed: false, files: retained
  };
  fs.writeFileSync(path.join(__dirname, 'U3-ADMISSION-MANIFEST.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(record.result);
  console.log('CANDIDATES=42 EXCLUDED=20 INVENTORY_SHA256=' + record.candidate_inventory_sha256);
}
try { main(); } catch (e) {
  // Only locally defined codes may reach retained output; never remote output or exception details.
  const code = typeof e.message === 'string' && /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'BLIND_SCAN_INTERNAL_FAIL';
  console.error(code);
  if (code === 'BLIND_SCAN_INTERNAL_FAIL') {
    const site = String(e.stack).match(/blind-credential-scan\.cjs:(\d+):\d+/);
    console.error('LOCAL_FAILURE_SITE=' + (site ? site[1] : 'UNKNOWN') +
      ' TYPE=' + e.name + ' OS_CODE=' + (/^[A-Z0-9_]+$/.test(e.code || '') ? e.code : 'NONE'));
  }
  process.exitCode = 1;
}
