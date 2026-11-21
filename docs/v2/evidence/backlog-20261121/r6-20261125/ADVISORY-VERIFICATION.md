# R6: independent verification of the two CISA KEV kernel advisories cited by run d (22 Nov 2026, run e)

**Authority.** Owner decision 2 of 2026-11-22 (round 4): independently check CVE-2026-53266 and CVE-2026-53362 and their CISA KEV
listing from public sources, distinguish the fixed kernel VERSION from KNOWN EXPOSURE on this host, and correct run d if wrong.
Reviewer F-011: three sources must agree (Ubuntu tracker, production's own changelog, KEV); a disagreement that weakens reason 1 of
the approved R6 verdict is an owner escalation; an unfetchable source is "not verified", never filled from memory.

**Result: all sources agree with run d (`r6-kernel-check-20261122/README.md` §2). No correction to run d is needed; the R6 verdict's
reason 1 stands.** Nothing here contacts production.

## 1. What was fetched (workstation, `curl`, public data only, generic user agent, no token, nothing about the owner or the project)

Retrieved 2026-11-21 21:02:47Z-21:03:16Z (Sun 22 Nov 08:02-08:03 AEDT). Raw responses kept outside the repository (session scratch);
the sha256 below identifies each response body exactly.

| File | URL | HTTP | Bytes | sha256 of the body |
|---|---|---|---|---|
| ubuntu-CVE-2026-53266.json | https://ubuntu.com/security/cves/CVE-2026-53266.json | 200 | 2,204,218 | `26fdcd34708ce0dc8ee380440af99a56d94affc24c0aa9b98ff217008f0c6acd` |
| ubuntu-CVE-2026-53266.html | https://ubuntu.com/security/CVE-2026-53266 | 200 | 1,303,956 | `8e8025a07acafa08f9f3cb34c442d15e3870c9838a394ef83997829a37d36c1d` |
| osv-UBUNTU-CVE-2026-53266.json | https://api.osv.dev/v1/vulns/UBUNTU-CVE-2026-53266 | 200 | 581,996 | `87b9cded4ed98648425462c1a656b6891a3dc1479458dbdffd78b7fe10993f80` |
| osv-CVE-2026-53266.json | https://api.osv.dev/v1/vulns/CVE-2026-53266 | 200 | 8,108 | `be79e2dd096888f98249980f2856783a63a6fea0a94823dc50188c234e2c5e33` |
| nvd-CVE-2026-53266.json | https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2026-53266 | 200 | 10,389 | `5c8205462c2914469d23213039459c986b90652c6b079d8890bc99f1d63d9cbf` |
| ubuntu-CVE-2026-53362.json | https://ubuntu.com/security/cves/CVE-2026-53362.json | 200 | 1,925,477 | `c28774764b4ec99e1ff2912d182877f3a0c7c18676c37bc8d2ae1f56d6012ff1` |
| ubuntu-CVE-2026-53362.html | https://ubuntu.com/security/CVE-2026-53362 | 200 | 1,285,996 | `5544dea777d425cd55dd1b87cebd27a38a2b2337980f3d487283f59d9dc358bd` |
| osv-UBUNTU-CVE-2026-53362.json | https://api.osv.dev/v1/vulns/UBUNTU-CVE-2026-53362 | 200 | 387,168 | `087a8fd365ca06d88860e211d70db1fd023a96ea556d577ef42a9e1ea3da97ad` |
| osv-CVE-2026-53362.json | https://api.osv.dev/v1/vulns/CVE-2026-53362 | 200 | 7,881 | `5047f7c2d2d4a1578d005140736b8b2e1baf3001e93c47419ad5c10ca8db62d4` |
| nvd-CVE-2026-53362.json | https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2026-53362 | 200 | 8,798 | `6d08733aa1d49c988997e67190c0041bd3b1d55616f99d3b7723c3a95967b7fa` |
| cisa-kev.json | https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json | 200 | 1,871,127 | `12c9ca4c5350ecacdf22bdce91b4ffcf06b8c8dc9c69b8bfb4c1a21be7a5fe50` |

DigitalOcean documentation fetched in the same run for the R6 runbook (section (b)) is listed in `ATTENDED-PLAN-R6-20261125.md` §3.

## 2. Per CVE: the fixed kernel version (sources must agree)

| | **CVE-2026-53266** | **CVE-2026-53362** |
|---|---|---|
| What (NVD/Ubuntu description) | netfilter: bridge: `ebt_snat` ARP rewrite not made writable (ebtables SNAT target out-of-bounds write) | ipv6: `__ip6_append_data()` does not account for `fraggap` on the paged-allocation path |
| CVSS 3.1 (NVD) | `AV:L/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H` 8.8: **local**, low privilege | `AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H` 7.8: **local**, low privilege |
| Ubuntu priority | high (reason: "See ubuntu cvss score") | high (reason: "Listed in CISA Known Exploited Vulnerabilities Catalog") |
| Ubuntu tracker, noble, source package `linux` | `released`, **6.8.0-146.146** (pocket security) | `released`, **6.8.0-147.147** (pocket security) |
| OSV `UBUNTU-…`, ecosystem `Ubuntu:24.04:LTS`, `linux` | fixed `6.8.0-146.146` | fixed `6.8.0-147.147` |
| Production's own changelog (`raw-output.txt:143-153`, `linux-modules-6.8.0-149-generic` entries newer than 137: 149, 148, 147, 146, 139) | **listed** (id present in the 2,148-id list) | **listed** |
| CISA KEV (catalogue 2026.11.20, released 2026-11-20T17:48:39Z, 1,790 entries) | listed, `dateAdded` **2026-09-18**, due 2026-09-21, "Linux Kernel Out-of-Bounds Write Vulnerability", ransomware use "Unknown" | listed, `dateAdded` **2026-08-27**, due 2026-08-30, "Linux Kernel Unspecified Vulnerability … privilege escalation via IPv6 networking subsystem", ransomware use "Unknown" |
| NVD `cisaExploitAdd` | 2026-09-18 | 2026-08-27 |
| **Fixed version <= installed 6.8.0-149?** | **yes** (146 <= 149) | **yes** (147 <= 149) |
| Fixed in the running 6.8.0-137? | **no** (146 > 137) | **no** (147 > 137) |

Limits of the agreement: production's changelog list is flat (`raw-output.txt:153`), so it proves each id is fixed somewhere in
139-149, not in which release; the release (146 / 147) comes from the Ubuntu tracker and OSV, which agree. The Ubuntu tracker lists
`linux-kvm` as `DNE` for noble and `linux-oem-6.8` as superseded: neither is this host's flavour (`linux-image-virtual` ->
`6.8.0-149-generic`, `raw-output.txt:27-33`). NVD's own analysis was not otherwise used.

## 3. Comparison with run d (`r6-kernel-check-20261122/README.md:39-48`)

| Run d statement | Verified value | Verdict |
|---|---|---|
| CVE-2026-53266 "ebtables SNAT target out-of-bounds write (local privilege escalation class)", KEV added 2026-09-18, Ubuntu priority high, fixed 6.8.0-146.146 | as stated; NVD vector is local (AV:L) | **agrees** |
| CVE-2026-53362 "IPv6 `__ip6_append_data` (local privilege escalation)", KEV added 2026-08-27, priority high, fixed 6.8.0-147.147 | as stated; KEV names it "Unspecified Vulnerability … privilege escalation via IPv6 networking subsystem" | **agrees** (KEV wording differs; substance equal) |
| KEV catalogue version 2026.11.20, 1,790 entries | 2026.11.20, 1,790 | **agrees** |
| "Both are fixed in the installed 149 and neither is fixed in the running 137" | yes | **agrees** |

Run d's README is therefore **not** amended. (The other KEV kernel entries run d names as fixed at or before 137 were not re-checked
here: they do not bear on the R6 decision.)

## 4. Fixed VERSION versus KNOWN EXPOSURE on this host

The fixed version is a fact about Ubuntu's packages (above). Exposure is a fact about this host and comes **only** from the read-only
host check of 22 Nov 07:15 AEDT (`raw-output.txt:160-166`); nothing below was re-probed in run e.

| | Known (host check) | Unknown (not established) | What a read-only check on Wed 25 Nov would add (arm, no sudo; already in `r6-pre-verify.sh` or one line) |
|---|---|---|---|
| CVE-2026-53266 (ebtables SNAT) | `kernel.apparmor_restrict_unprivileged_userns = 1` (Ubuntu restricts unprivileged user namespaces, the usual way an unprivileged process reaches netfilter/ebtables configuration); `kernel.unprivileged_userns_clone = 1`; **no ebtables or bridge module loaded** | whether module autoloading would load `ebtables`/`ebt_snat` on demand for a local attacker; whether any AppArmor profile in use grants `userns`; whether a process with `CAP_NET_ADMIN` exists that an attacker could reach | `lsmod` filter again (still none loaded), `cat /proc/sys/kernel/modules_disabled` (expect 0: autoload possible), `ls /etc/modprobe.d/` for a blacklist (none expected). None of these removes the vulnerability; they only bound reachability |
| CVE-2026-53362 (IPv6 append path) | `net.ipv6.conf.all.disable_ipv6 = 0` (**IPv6 enabled**); no mitigation visible | whether an exploit needs anything beyond a local unprivileged socket (the CVSS vector says local, low privilege, no user interaction) | nothing short of disabling IPv6 would reduce it, which is a configuration change, not a check |
| Both | local code execution is a precondition (CVSS AV:L, PR:L): they turn a compromise of the Node application, Caddy or a local account into root; they are not remote entry points by themselves. No Livepatch, Ubuntu Pro not attached (`raw-output.txt:72-94`) | actual exploitability on this droplet (never to be tested on production) | — |

**Conclusion for the owner.** The two actively exploited local-privilege-escalation fixes are present in the installed 149 and absent
from the running 137, as run d said. Reachability on this host is reduced for the ebtables path (module not loaded, userns
restricted) but not established as impossible, and not reduced for the IPv6 path. The R6 reboot remains warranted on the same
grounds; this verification adds no new reason and removes none.
