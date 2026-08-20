---
name: afldb-runtime-deploy-debug
description: Diagnose AFLDB deployment and runtime defects involving Next.js standalone output, Node cluster workers, systemd, Caddy, TLS, hostnames, environment variables, PostgreSQL connectivity/privileges, backup/restore readiness, health routes, or differences between development and deployed behaviour.
---

# AFLDB Runtime and Deployment Debugging

Separate code defects from host/configuration defects before changing either.

## Guardrails

- Inspect local repository configuration first.
- Do not run Git commands unless explicitly requested.
- Do not change a remote server, systemd unit, Caddy configuration, DNS, database privileges, or production environment unless the user explicitly asks for that operational action.
- Never expose secrets.
- Preserve beta/indexing separation and production fail-closed settings.
- Do not treat Windows-only results as authoritative for Linux runtime behaviour.

## Map the deployed path

Trace:

`client -> DNS/TLS -> Caddy -> systemd/service -> Node cluster worker -> Next.js -> PostgreSQL`

For the failing request identify the first unhealthy boundary.

## Check configuration consistency

Compare documented and actual expectations for:

- `AFLDB_ENV`;
- `AFLDB_INDEXING`;
- `AFLDB_BASE_URL`;
- session/beta settings;
- database URLs by role;
- `PORT`;
- worker count;
- pool max;
- statement timeout;
- SMTP host/port/secure mode;
- standalone build output.

Do not substitute one database role for another to get around a permission error.

## Database after restore

Application read access intentionally fails closed for newly restored/ungranted objects. If a restore is involved, check whether privileges were reconciled with the documented `npm run db:privileges` step before changing application code.

## Diagnose by evidence

Use:

- service status and journal logs;
- Caddy access/error logs;
- health endpoint;
- local loopback request versus public-host request;
- environment presence without printing secret values;
- PostgreSQL connectivity under the intended role;
- process/worker restart evidence.

## Patch strategy

If local code is wrong, make the minimal code/config-template change and test locally. If the deployed host is wrong but repository code is correct, report the exact operational correction separately; do not encode a host-specific workaround into application logic.

For launch/readiness faults, preserve the documented production-cutover gates rather than bypassing them.
