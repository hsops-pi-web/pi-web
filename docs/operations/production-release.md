# Production Release Runbook

This project releases production from immutable standalone builds under `/home/hsops/pi-web-auth-deploy`. Production must not run `.next` from the source worktree.

## Preconditions

- `/home/hsops/pi-web-auth` is clean `main`.
- Feature work has passed non-8000 acceptance in an isolated worktree.
- `/home/hsops/.config/pi-web-auth/release.env` exists with mode `0600` and contains `PI_WEB_RELEASE_TOKEN` and `REGISTER_KEYWORD`.
- The operator has explicit approval before any command that drains or stops production.

## Build Before Stopping Production

Run these after user acceptance and merge to `main`, before stopping service on port 8000:

```bash
cd /home/hsops/pi-web-auth
git status --short --branch
HOME=/home/hsops npm ci
HOME=/home/hsops npm run verify
```

Build a standalone release. The script creates a detached worktree, runs `npm ci`, `npm run verify`, `npm run build`, assembles the release, and performs isolated staging verification without stopping production:

```bash
sudo -u hsops /home/hsops/pi-web-auth/scripts/build-release.sh
```

The command prints the release directory. Record the release ID from the final path, for example `20260713-160000-05816e7`.

## First Legacy Migration

The legacy `.next` process does not have drain, lifecycle, `session_shutdown`, or dispose support. The first migration is the only allowed exception. The operator must confirm there are no active replies, and the confirmation value must be the target release ID.

```bash
RELEASE_ID=<release-id>
/home/hsops/pi-web-auth/scripts/migrate-first-release.sh \
  --release "/home/hsops/pi-web-auth-deploy/releases/$RELEASE_ID" \
  --allow-legacy-stop \
  --confirm-no-active-replies "$RELEASE_ID"
```

For the first migration, the 60-second outage budget starts immediately before `legacy_stop`. The log must show `legacy_stop`, not drain. This exception is allowed once only; every standalone release after this must use normal drain.

## Normal Standalone Release

After the first standalone release is running, use the normal release script:

```bash
/home/hsops/pi-web-auth/scripts/release-production.sh
```

The normal 60-second outage budget starts when `/api/internal/drain` is requested. It includes drain, service stop, final rsync, final SQLite snapshot, and validation. Detached build, staging verification, disk check, and online pre-backup happen before this budget starts. The new release ready window is a separate 30 seconds.

If the new release fails readiness, the script switches `current` back to `previous`, starts the old service, and verifies it. Code rollback does not restore user data.

## Post-Release Checks

```bash
readlink -f /home/hsops/pi-web-auth-deploy/current
readlink -f /home/hsops/pi-web-auth-deploy/previous
systemctl --user status pi-web-auth.service --no-pager
curl -fsS http://127.0.0.1:8000/api/health/ready
find /home/hsops/pi-web-auth-backups -mindepth 1 -maxdepth 1 -type d -name '[!.]*' | wc -l
```

Run the ready check three times and confirm the release ID and commit match `release.json`.

## Data Count Checks

Use counts only; do not print user records, tokens, messages, or provider credentials.

```bash
BACKUP_ID=<release-id>
BACKUP=/home/hsops/pi-web-auth-backups/$BACKUP_ID/backup.json
node -e 'const m=require(process.argv[1]); console.log(JSON.stringify(m.counts,null,2))' "$BACKUP"
node - <<'NODE'
const Database = require('better-sqlite3');
const db = new Database('/home/hsops/.pi-web-auth/auth.db', { readonly: true });
console.log(JSON.stringify({
  users: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
  loginSessions: db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count,
  modelPreferences: db.prepare('SELECT COUNT(*) AS count FROM user_model_preferences').get().count,
}, null, 2));
db.close();
NODE
find /home/hsops/.pi/agent -type f -name '*.jsonl' | wc -l
```

Compare these values with `backup.json` counts. Investigate mismatches before cleanup.

## Retention Rules

- Keep `current` plus three historical releases, four total.
- Keep seven verified production data backups.
- Never automatically delete `.incomplete-*`, failed staging releases, migration backups, invalid backup directories, or failure logs.
