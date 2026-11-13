#!/usr/bin/env bash
# hostops ISSUE-351: syntax + match check of the prepared needrestart policy file in plain perl (needrestart itself is neither
# installed nor run on this host or on production: plan review H-5). Loads the file as needrestart does (perl `do`) into a local
# %nrconf and tests the two override_rc regexes against unit names.
W=/mnt/ssd/afldb-rem-hostops-20261114
perl -e '
our %nrconf;
my $f = shift;
my $r = do $f;
die "parse/read failed: $@ $!" if $@ || !defined $r;
for my $re (keys %{$nrconf{override_rc}}) {
  print "override_rc $re => $nrconf{override_rc}{$re}\n";
}
for my $u (qw(afldb.service postgresql.service postgresql@16-main.service caddy.service ssh.service cron.service)) {
  my @hit = grep { $u =~ $_ } keys %{$nrconf{override_rc}};
  printf "  %-28s %s\n", $u, @hit ? "held (rc 0)" : "not held";
}
' "$W/cand/deploy/host-policy/needrestart-afldb-hold.conf"
