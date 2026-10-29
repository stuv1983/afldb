"""AFLDB-ISSUE-320: derive the enforced native closure for a guarded rehearsal runtime on THIS host.

Seeds: the record's bound executables, every ELF file inside its bound runtime roots, the PostgreSQL
server module directory (dlopen by the postmaster/backends, llvmjit included), the shell pg_ctl execs,
the NSS modules /etc/nsswitch.conf names, and the auditor itself. Transitive DT_NEEDED resolution is
the system loader's own (`ld.so --list`), which runs no program code. Objects observed only by the
RECORD-ONLY auditor build (dlopen extras) are added solely from an explicit reviewed list.

Writes, into a NEW directory: closure-derivation.json (every object with its reason), native-policy.txt
(the exact text the auditor enforces) and runtime-record-v3.json (the input record, schema_version 3,
carrying `native_closure`). Read-only against everything else.
usage: python3 -I derive-closure.py <runtime-record-v2.json> <auditor.so> <new-out-dir> [reviewed-extras.txt]
"""
import hashlib, json, os, re, stat, subprocess, sys

LOADER = '/lib64/ld-linux-x86-64.so.2'
record = json.load(open(sys.argv[1]))
auditor = os.path.realpath(sys.argv[2])
out = sys.argv[3]
extras_file = sys.argv[4] if len(sys.argv) > 4 else None
if record.get('schema_version') != 2:
    raise SystemExit('input must be a version 2 runtime record')
if ':' in auditor or ' ' in auditor:
    raise SystemExit('auditor path may not contain an LD_AUDIT separator')


def is_elf(p):
    try:
        with open(p, 'rb') as f:
            return f.read(4) == b'\x7fELF'
    except OSError:
        return False


seeds = {}  # realpath -> reason
def seed(p, why):
    r = os.path.realpath(p)
    if is_elf(r):
        seeds.setdefault(r, why)


for e in record['executables']:
    seed(e['path'], 'bound executable')
seed(record['esbuild_binary'], 'bound esbuild binary')
for root in record['roots']:
    for f in root['files']:
        p = os.path.join(root['path'], f['path'])
        if is_elf(p):
            seed(p, 'ELF inside bound root ' + root['path'])
seed('/bin/sh', 'pg_ctl starts the postmaster through /bin/sh')
pglib = '/usr/lib/postgresql/16/lib'
for name in sorted(os.listdir(pglib)):
    p = os.path.join(pglib, name)
    if name.endswith('.so') and os.path.isfile(p):
        seed(p, 'PostgreSQL 16 server module (dlopen by the postmaster/backends)')
nss = set()
for line in open('/etc/nsswitch.conf'):
    m = re.match(r'^\s*(passwd|group|shadow|hosts|services|protocols|networks|initgroups)\s*:\s*(.*)$', line)
    if m:
        for svc in re.findall(r'\b([a-z_]+)\b', m.group(2)):
            if svc not in ('files', 'dns', 'return', 'continue', 'success', 'notfound', 'unavail', 'tryagain', 'merge'):
                nss.add(svc)
for svc in sorted(nss):
    for d in ('/usr/lib/x86_64-linux-gnu', '/lib/x86_64-linux-gnu'):
        p = os.path.join(d, f'libnss_{svc}.so.2')
        if os.path.exists(p):
            seed(p, f'NSS module "{svc}" named by /etc/nsswitch.conf')
            break
seed(auditor, 'the bound auditor')

closure = dict(seeds)
static = []
pending = list(seeds)
while pending:
    s = pending.pop()
    r = subprocess.run([LOADER, '--list', s], capture_output=True, text=True)
    if r.returncode != 0 or 'not a dynamic' in (r.stdout + r.stderr) or r.stdout.strip() == 'statically linked':
        static.append(s)
        continue
    for line in r.stdout.splitlines():
        line = line.strip()
        m = re.match(r'^(\S+) => (\S+) \(0x[0-9a-f]+\)$', line) or re.match(r'^(/\S+) \(0x[0-9a-f]+\)$', line)
        if not m:
            if line.startswith('linux-vdso.so') or not line:
                continue
            raise SystemExit(f'unparsed loader line for {s}: {line!r}')
        target = m.group(2) if m.lastindex == 2 else m.group(1)
        if target == 'not':
            raise SystemExit(f'unresolved dependency of {s}: {line}')
        real = os.path.realpath(target)
        if real not in closure:
            closure[real] = f'DT_NEEDED of {s}'
            pending.append(real)

if extras_file:
    for line in open(extras_file):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        path, why = line.split(' ', 1)
        if os.path.realpath(path) != path:
            raise SystemExit(f'reviewed extra is not canonical: {path}')
        closure.setdefault(path, 'reviewed extra: ' + why)

os.makedirs(out, exist_ok=False)
rows = []
for p in sorted(closure):
    st = os.lstat(p)
    if not stat.S_ISREG(st.st_mode) or st.st_mode & (stat.S_ISUID | stat.S_ISGID):
        raise SystemExit(f'not a plain regular file: {p}')
    if p != os.path.realpath(p) or not re.match(r'^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$', p):
        raise SystemExit(f'noncanonical path: {p}')
    h = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    rows.append({'path': p, 'sha256': h, 'size': st.st_size, 'nlink': st.st_nlink, 'reason': closure[p]})
loader = os.path.realpath(LOADER)
ah = next(r['sha256'] for r in rows if r['path'] == auditor)
native_closure = {'schema_version': 1, 'loader': loader, 'auditor': {'path': auditor, 'sha256': ah},
                  'objects': [{'path': r['path'], 'sha256': r['sha256']} for r in rows]}
json.dump({'host': os.uname().nodename, 'loader': loader, 'static_seeds': sorted(static), 'objects': rows},
          open(os.path.join(out, 'closure-derivation.json'), 'w'), indent=1)
# Byte-identical to nativePolicyText() in tools/v2/rehearsal-package.mjs.
text = 'afldb-native-closure-policy 1\n' + f'auditor {ah} {auditor}\n' + ''.join(f"object {r['sha256']} {r['path']}\n" for r in rows)
open(os.path.join(out, 'native-policy.txt'), 'w', newline='\n').write(text)
v3 = dict(record, schema_version=3, native_closure=native_closure)
with open(os.path.join(out, 'runtime-record-v3.json'), 'w', newline='\n') as f:
    f.write(json.dumps(v3, separators=(',', ':')))
print('objects', len(rows), 'bytes', sum(r['size'] for r in rows), 'static', static)
print('policy sha256', hashlib.sha256(text.encode()).hexdigest())
print('multi-link files', [r['path'] for r in rows if r['nlink'] != 1])
