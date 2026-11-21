#!/usr/bin/env bash
# R6 read-only kernel / livepatch / security-advisory check (owner decision 4 of 2026-11-22, round 3). PRODUCTION, as arm.
# READ-ONLY: no sudo, no apt update/upgrade/changelog, no network call by this script, no file written (prints only).
# Every probe is individually bounded (`timeout`) and non-fatal; the whole run is bounded by the caller's single connection.
# Rehearsed in full on streamanator first (reviewer F-006). Run (workstation, ONE connection, outside 02:10-02:40 and 04:50-07:15 AEDT):
#   tr -d '\r' < check.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s
main() {
set -u; export LC_ALL=C
t() { timeout 20 "$@" 2>&1; }
sec() { echo; echo "-- $*"; }
echo "== R6 kernel check $(date -u +%FT%TZ) host=$(hostname) user=$(id -un)"
sec "os"; grep -E '^(PRETTY_NAME|VERSION_ID|VERSION_CODENAME)=' /etc/os-release
sec "running kernel"; uname -r; uname -v; cat /proc/version_signature 2>&1
sec "uptime"; uptime; echo "up since $(uptime -s)"
sec "kernel cmdline (no secrets expected)"; cat /proc/cmdline
sec "virtualisation / provider"; t systemd-detect-virt; cat /sys/class/dmi/id/sys_vendor /sys/class/dmi/id/product_name 2>&1; t cloud-id
sec "installed kernel packages (dpkg status)"
dpkg-query -W -f='${db:Status-Abbrev} ${Package} ${Version}\n' 'linux-image-*' 'linux-modules-*' 'linux-generic*' 'linux-image-generic*' 'linux-base' 'libc6' 2>/dev/null | grep -vE '^(un|rc|pn) ' | sort -k2
sec "/boot kernels"; ls -l --time-style=long-iso /boot/vmlinuz-* /boot/initrd.img-* 2>&1
sec "reboot-required"; ls -l --time-style=full-iso /var/run/reboot-required /var/run/reboot-required.pkgs 2>&1
cat /var/run/reboot-required 2>&1; cat /var/run/reboot-required.pkgs 2>&1
sec "GRUB defaults"; grep -HE '^GRUB_(DEFAULT|TIMEOUT|TIMEOUT_STYLE|RECORDFAIL_TIMEOUT|SAVEDEFAULT|DISABLE_SUBMENU)=' /etc/default/grub /etc/default/grub.d/*.cfg 2>&1
sec "GRUB menu entry titles (first 12)"; grep -E "^[[:space:]]*(menuentry|submenu) " /boot/grub/grub.cfg 2>&1 | sed -E "s/^[[:space:]]*((menuentry|submenu) '[^']*').*/\1/" | head -12
sec "grubenv"; t grub-editenv list
sec "livepatch"; command -v canonical-livepatch || echo "canonical-livepatch: not installed"
if command -v canonical-livepatch >/dev/null 2>&1; then t canonical-livepatch status --verbose | head -40; fi
t snap list 2>&1 | grep -iE '^(Name|canonical-livepatch)' || echo "snap: no livepatch snap listed"
sec "ubuntu pro (cached status file only; no network)"
command -v pro || echo "pro: not installed"
f=/var/lib/ubuntu-advantage/status.json
if [ -r "$f" ]; then
  ls -l --time-style=full-iso "$f"
  python3 -I - "$f" <<'PY' 2>&1
import json, sys
d = json.load(open(sys.argv[1]))
print("attached:", d.get("attached"), "| execution_status:", d.get("execution_status"), "| _doc_version:", d.get("_doc_version"))
for s in d.get("services", []):
    print("service %-22s status=%-10s entitled=%s available=%s" % (s.get("name"), s.get("status"), s.get("entitled"), s.get("available")))
PY
else
  echo "status cache $f: absent or unreadable"
fi
sec "pro security-status (local apt cache; bounded)"
if command -v pro >/dev/null 2>&1; then t pro security-status --format json | python3 -I -c '
import json,sys
try:
    d=json.load(sys.stdin)
except Exception as e:
    print("unparsed:", e); sys.exit(0)
print("summary:", json.dumps(d.get("summary", {}), sort_keys=True)[:1500])
for p in d.get("packages", []):
    if p.get("status") in ("pending_kernel_livepatch_cve_fix","upgrade_available","pending_attach","pending_enable") or "linux" in p.get("package",""):
        print("pkg", p.get("package"), p.get("version"), p.get("status"), p.get("origin"))
' 2>&1 | head -60; fi
sec "apt upgradable (existing cache, NO update)"
ls -l --time-style=full-iso /var/lib/apt/lists/*InRelease 2>/dev/null | awk '{print $6, $7, $9}' | head -8
apt list --upgradable 2>/dev/null | grep -c / | sed 's/^/upgradable count: /'
apt list --upgradable 2>/dev/null | grep -iE 'linux|libc6|openssl|openssh|systemd|sudo|security' | head -60
sec "unattended-upgrades policy (reboot keys)"
apt-config dump 2>/dev/null | grep -iE 'Unattended-Upgrade::(Automatic-Reboot|Package-Blacklist|Allowed-Origins|Origins-Pattern)' | head -20
sec "apt timers"; systemctl list-timers apt-daily.timer apt-daily-upgrade.timer afldb-settle-afl-api.timer --no-pager 2>&1 | head -8
sec "dpkg history of kernel packages (dpkg.log*, readable as arm)"
{ cat /var/log/dpkg.log 2>/dev/null; for z in /var/log/dpkg.log.*.gz; do [ -r "$z" ] && zcat "$z"; done; cat /var/log/dpkg.log.1 2>/dev/null; } \
  | grep -E ' (install|upgrade) linux-(image|modules)-[0-9]' | sort -u | tail -30
sec "kernel changelog CVEs from the newest installed image back to the running one"
RUN=${R6_RUN:-$(uname -r | sed "s/-generic$//")}
NEW=$(dpkg-query -W -f='${db:Status-Abbrev} ${Package}\n' 'linux-image-[0-9]*-generic' 2>/dev/null | awk '$1 ~ /^ii/ {print $2}' | sed 's/^linux-image-//; s/-generic$//' | sort -V | tail -1)
echo "running=$RUN newest_installed=$NEW"
CL=""
for c in /usr/share/doc/linux-modules-$NEW-generic/changelog.Debian.gz /usr/share/doc/linux-image-$NEW-generic/changelog.Debian.gz; do [ -r "$c" ] && { CL=$c; break; }; done
if [ -n "$CL" ]; then
  echo "changelog: $CL ($(stat -c %s "$CL") bytes)"
  # Entries are newest first; stop at the first entry whose ABI number (6.8.0-<ABI>.<n>) is <= the running ABI. Ubuntu
  # security respins (for example 137, 138, 142) have no entry of their own in a later changelog, so the list is an upper bound.
  RABI=${RUN##*-}
  TXT=$(zcat "$CL" | awk -v rabi="$RABI" 'BEGIN{p=1} /^linux[-a-z]* \(/ { v=$2; gsub(/[()]/,"",v); split(v, a, "-"); split(a[2], b, "."); if (b[1] + 0 <= rabi + 0) p=0; if (p) print "ENTRY " $0 } p { print }')
  printf '%s\n' "$TXT" | grep '^ENTRY ' | sed 's/^ENTRY /  /'
  echo "distinct CVE ids in entries newer than $RUN: $(printf '%s\n' "$TXT" | grep -oE 'CVE-[0-9]{4}-[0-9]+' | sort -u | wc -l)"
  echo "CVE-LIST-BEGIN"; printf '%s\n' "$TXT" | grep -oE 'CVE-[0-9]{4}-[0-9]+' | sort -u | tr '\n' ' '; echo; echo "CVE-LIST-END"
else
  echo "no readable changelog.Debian.gz for $NEW under /usr/share/doc (CVE list must come from public sources)"
  ls -ld /usr/share/doc/linux-image-$NEW-generic /usr/share/doc/linux-modules-$NEW-generic 2>&1
fi
sec "kernel taint and lockdown"; cat /proc/sys/kernel/tainted; cat /sys/kernel/security/lockdown 2>&1
sec "exposure context for the two CISA KEV kernel CVEs (ebtables SNAT; IPv6 append path): readable sysctls and modules"
for k in kernel.apparmor_restrict_unprivileged_userns kernel.unprivileged_userns_clone user.max_user_namespaces net.ipv6.conf.all.disable_ipv6; do
  printf '%s = %s\n' "$k" "$(cat /proc/sys/$(echo "$k" | tr . /) 2>/dev/null || echo n/a)"; done
echo "loaded modules (ebtables/bridge/netfilter bridge):"; grep -E '^(ebt[a-z_]*|ebtables|bridge|br_netfilter) ' /proc/modules | awk '{print "  " $1}' || true
[ -n "$(grep -E '^(ebt[a-z_]*|ebtables) ' /proc/modules)" ] || echo "  no ebtables module loaded"
echo; echo "R6 CHECK DONE $(date -u +%FT%TZ)"
}
main "$@" < /dev/null
