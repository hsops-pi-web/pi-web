# Production Release Runbook

This runbook describes the optional immutable standalone release flow. Adjust paths through environment variables if your deployment layout differs.

## Default Public Layout

- Source root: `/opt/pi-web-auth/source`
- Deploy root: `/opt/pi-web-auth`
- Current release symlink: `/opt/pi-web-auth/current`
- Previous release symlink: `/opt/pi-web-auth/previous`
- Data home: `/var/lib/pi-web-auth`
- Backup root: `/var/backups/pi-web-auth`
- Release env file: `/etc/pi-web-auth/release.env`

## Required Environment File

Create `/etc/pi-web-auth/release.env` with mode `0600`:

```bash
PI_WEB_RELEASE_TOKEN=<random-hex-token>
REGISTER_KEYWORD=<registration-keyword>
PI_WEB_SUPER_ADMIN_USERNAME=admin
```

Optional overrides:

```bash
PI_WEB_SOURCE_ROOT=/opt/pi-web-auth/source
PI_WEB_DEPLOY_ROOT=/opt/pi-web-auth
PI_WEB_BACKUP_ROOT=/var/backups/pi-web-auth
PI_WEB_PRODUCTION_HOME=/var/lib/pi-web-auth
PI_WEB_RELEASE_ENV=/etc/pi-web-auth/release.env
```

## Preconditions

- Source root is a clean `main` worktree.
- `npm run verify` passes.
- The service unit is based on `systemd/pi-web-auth.service.example`.
- The operator has approval before draining or stopping production.

## Build Before Stopping Production

```bash
cd /opt/pi-web-auth/source
git status --short --branch
npm ci
npm run verify
scripts/build-release.sh
```

The build script creates a detached worktree, runs verification, builds the standalone app, assembles a release directory, and performs isolated staging verification before production is touched.

## First Migration From a Non-Standalone Service

Use this only if the currently running service is not yet a standalone release managed by these scripts.

```bash
RELEASE_ID=<release-id>
scripts/migrate-first-release.sh \
  --release "/opt/pi-web-auth/releases/$RELEASE_ID" \
  --allow-legacy-stop \
  --confirm-no-active-replies "$RELEASE_ID"
```

This path requires explicit confirmation that there are no active replies. After this migration, use the normal release flow.

## Normal Release

```bash
scripts/release-production.sh
```

The script performs an online pre-backup, requests drain, stops the service, takes a final data snapshot, switches the `current` symlink, starts the new release, and validates readiness. If the new release is not ready, it switches back to `previous` and verifies the old release.

## Post-Release Checks

```bash
readlink -f /opt/pi-web-auth/current
readlink -f /opt/pi-web-auth/previous
systemctl status pi-web-auth.service --no-pager
curl -fsS http://127.0.0.1:8000/api/health/ready
find /var/backups/pi-web-auth -mindepth 1 -maxdepth 1 -type d -name '[!.]*' | wc -l
```

Run the ready check more than once and confirm the release ID and commit match the target `release.json`.

## Data Count Checks

Use counts only. Do not print user records, cookies, tokens, messages, or provider credentials.

```bash
BACKUP_ID=<release-id>
BACKUP=/var/backups/pi-web-auth/$BACKUP_ID/backup.json
node -e 'const m=require(process.argv[1]); console.log(JSON.stringify(m.counts,null,2))' "$BACKUP"
find /var/lib/pi-web-auth/.pi/agent -type f -name '*.jsonl' | wc -l
```

Investigate count mismatches before cleanup.

## Retention Rules

- Keep `current` plus three historical releases, four total.
- Keep seven verified production data backups.
- Never automatically delete `.incomplete-*`, failed staging releases, migration backups, invalid backup directories, or failure logs.
