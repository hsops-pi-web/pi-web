# Production Rollback And Restore Runbook

Program rollback and data restore are separate operations. A code rollback must not restore user data. A data restore must not switch `current` or `previous`.

## Program Rollback

Use this when the current standalone release is bad but `previous` is known healthy.

```bash
systemctl --user stop pi-web-auth.service
OLD_CURRENT=$(readlink -f /home/hsops/pi-web-auth-deploy/current)
OLD_PREVIOUS=$(readlink -f /home/hsops/pi-web-auth-deploy/previous)
test -f "$OLD_PREVIOUS/release.json"
cat "$OLD_PREVIOUS/release.json"
ln -sfn "$OLD_CURRENT" /home/hsops/pi-web-auth-deploy/previous.tmp
mv -Tf /home/hsops/pi-web-auth-deploy/previous.tmp /home/hsops/pi-web-auth-deploy/previous
ln -sfn "$OLD_PREVIOUS" /home/hsops/pi-web-auth-deploy/current.tmp
mv -Tf /home/hsops/pi-web-auth-deploy/current.tmp /home/hsops/pi-web-auth-deploy/current
systemctl --user start pi-web-auth.service
```

Then run readiness three times:

```bash
curl -fsS http://127.0.0.1:8000/api/health/ready
curl -fsS http://127.0.0.1:8000/api/health/ready
curl -fsS http://127.0.0.1:8000/api/health/ready
```

Confirm the release ID and commit match the target `release.json`.

## Automatic Rollback Failure

If a release script reports that both the new release and `previous` are not ready:

- Do not run retention or cleanup.
- Preserve release directories, backups, logs, and failed staging directories.
- Capture `readlink -f` for `current` and `previous`.
- Capture `journalctl --user -u pi-web-auth.service --no-pager` without printing release token or provider credentials.
- For first migration failure, restore the saved legacy unit and legacy `.next` from `/home/hsops/pi-web-auth-deploy/migration/`.
- For normal standalone failure, manually point `current` to a known healthy release and restart.

## Data Restore

Data restore requires the service to be stopped and a verified backup. Start with dry-run:

```bash
systemctl --user stop pi-web-auth.service
/home/hsops/pi-web-auth/scripts/restore-production-backup.sh <backup-id>
```

Apply only after reviewing the dry-run output:

```bash
/home/hsops/pi-web-auth/scripts/restore-production-backup.sh --apply <backup-id>
```

The script prompts for the complete backup ID before writing data. It validates `backup.json`, database integrity, and directory presence before rsync.

After restore, validate counts before starting service:

```bash
/home/hsops/.nvm/versions/node/v24.17.0/bin/node /home/hsops/pi-web-auth/scripts/backup-production.mjs validate \
  --backup-root /home/hsops/pi-web-auth-backups \
  --backup-id <backup-id>
find /home/hsops/.pi/agent -type f -name '*.jsonl' | wc -l
systemctl --user start pi-web-auth.service
curl -fsS http://127.0.0.1:8000/api/health/ready
```

## Severe Failure Rules

- Do not delete `.incomplete-*`, failed releases, migration backups, invalid backup directories, or logs.
- Do not paste `release.env`, curl config, cookies, API keys, or provider credentials into tickets.
- Do not run `npm audit fix --force` during rollback.
- Keep data restore and code rollback separate unless a human operator explicitly approves both operations.
