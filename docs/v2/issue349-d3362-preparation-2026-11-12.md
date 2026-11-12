# ISSUE-349: proposed D-336-2 preparation at the UTC ops pin

Status: LOCAL PREPARATION. Not approved for executable publication or production use.
The owner approved local implementation/qualification and separately approved publication
of records 633e4390/595dc394 (completed).

## Pins

- Ops revision: a25306f930015acef602bcc60d76613bdcc3d466.
- Prepared pack: streamanator /mnt/ssd/afldb-i349-20261112/green-pack/pack-a25306f9/cand.tar.gz.
- SHA256: 48f43dc840a6f97e0b24b588ff50cd04463521eb6377c94f1a3527780d353685.
- New ops directory: /home/arm/ops/gap029-stages/a25306f9.
- Serving application remains c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x.
- Evidence and qualification: evidence/issue349-utc-20261112/README.md.

## Review and execution order

1. Review the two-file executable delta from 595dc394 to a25306f9 and qualification results.
2. Obtain separate approval to publish the fix and its records by fast-forward.
3. Obtain fresh A+B and C+D approval below. Do not reuse the failed 12 November capture.
4. Use the existing D-336-2 packet section 4 direct route, replacing its ops revision R with the
   full new revision above, OPS with the new directory, and its tarball input with this prepared pack.
   Keep all target, backup, actor, sealed-assembly, freshness and refusal guards.
   Choose a new restore workspace; retain the old production capture and evidence.
5. Stop after read-only planning. Present the actual production plan digest, backup hash and
   proposed OD-4 window. Simulation digests are not production approval inputs.

## Proposed fresh preparation approval

I approve D-336-2 Steps A+B and C+D at ops revision
a25306f930015acef602bcc60d76613bdcc3d466, using the prepared tarball SHA256
48f43dc840a6f97e0b24b588ff50cd04463521eb6377c94f1a3527780d353685.
Upload and prep it under /home/arm/ops/gap029-stages/a25306f9 on afldb-prod as arm,
run preflight and ONE fresh capture of afldb_prod as afldb_backup, copy it to a new
mode-700 workspace on streamanator, restore it into a guarded disposable database,
assemble sealed I336 evidence, upload backup.json and restore-evidence.json and run
the read-only plan. Preserve the prior failed run. Stop before approve/apply and return
the actual production plan digest, backup hash and proposed OD-4 window.
No production database write, service/restart, timer, application or configuration change.

This proposed statement does not grant approval; the owner must provide it.
