# Production Rollback And Restore Runbook

Code rollback and data restore are separate operations. A code rollback must not restore user data. A data restore must not switch release symlinks.

Default public paths:

- Deploy root: `/opt/pi-web-auth`
- Data home: `/var/lib/pi-web-auth`
- Backup root: `/var/backups/pi-web-auth`
- Source root: `/opt/pi-web-auth/source`

Override these with the `PI_WEB_*` environment variables documented in `production-release.md`.

## Code Rollback

Use this when the current standalone release is bad but `previous` is known healthy.

```bash
systemctl stop pi-web-auth.service
OLD_CURRENT=$(readlink -f /opt/pi-web-auth/current)
OLD_PREVIOUS=$(readlink -f /opt/pi-web-auth/previous)
test -f "$OLD_PREVIOUS/release.json"
cat "$OLD_PREVIOUS/release.json"
ln -sfn "$OLD_CURRENT" /opt/pi-web-auth/previous.tmp
mv -Tf /opt/pi-web-auth/previous.tmp /opt/pi-web-auth/previous
ln -sfn "$OLD_PREVIOUS" /opt/pi-web-auth/current.tmp
mv -Tf /opt/pi-web-auth/current.tmp /opt/pi-web-auth/current
systemctl start pi-web-auth.service
```

Run readiness more than once:

```bash
curl -fsS http://127.0.0.1:8000/api/health/ready
curl -fsS http://127.0.0.1:8000/api/health/ready
curl -fsS http://127.0.0.1:8000/api/health/ready
```

Confirm the release ID and commit match the target `release.json`.

## Data Restore

Data restore requires the service to be stopped and a verified backup. Start with dry-run:

```bash
systemctl stop pi-web-auth.service
/opt/pi-web-auth/source/scripts/restore-production-backup.sh <backup-id>
```

Apply only after reviewing the dry-run output:

```bash
/opt/pi-web-auth/source/scripts/restore-production-backup.sh --apply <backup-id>
```

The script prompts for the complete backup ID before writing data. It validates `backup.json`, database integrity, and directory presence before rsync.

After restore:

```bash
/opt/pi-web-auth/source/scripts/backup-production.mjs validate \
  --backup-root /var/backups/pi-web-auth \
  --backup-id <backup-id>
find /var/lib/pi-web-auth/.pi/agent -type f -name '*.jsonl' | wc -l
systemctl start pi-web-auth.service
curl -fsS http://127.0.0.1:8000/api/health/ready
```

## Severe Failure Rules

- Do not delete `.incomplete-*`, failed releases, migration backups, invalid backup directories, or logs.
- Do not paste `release.env`, curl configs, cookies, API keys, or provider credentials into tickets.
- Do not run broad dependency update commands during rollback.
- Keep data restore and code rollback separate unless a human operator explicitly approves both operations.
