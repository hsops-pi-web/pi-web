#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

BACKUP_ROOT=${PI_WEB_BACKUP_ROOT:-/var/backups/pi-web-auth}
HOME_ROOT=${PI_WEB_PRODUCTION_HOME:-/var/lib/pi-web-auth}
SYSTEMCTL_BIN=${PI_WEB_SYSTEMCTL_BIN:-systemctl}
NODE_BIN=${PI_WEB_NODE_BIN:-node}
RSYNC_BIN=${PI_WEB_RSYNC_BIN:-rsync}
DRY_RUN=true
[[ "${1:-}" == "--apply" ]] && { DRY_RUN=false; shift; }
BACKUP_ID=${1:-}
[[ "$BACKUP_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || { echo "invalid backup id" >&2; exit 2; }
BACKUP_DIR="$BACKUP_ROOT/$BACKUP_ID"

if "$SYSTEMCTL_BIN" --user is-active --quiet pi-web-auth.service; then
  echo "pi-web-auth.service must be stopped" >&2
  exit 1
fi
"$NODE_BIN" "$(dirname "$0")/backup-production.mjs" validate --backup-root "$BACKUP_ROOT" --backup-id "$BACKUP_ID"

RSYNC_ARGS=(-a --delete)
if [[ "$DRY_RUN" == true ]]; then RSYNC_ARGS+=(--dry-run --itemize-changes); fi
if [[ "$DRY_RUN" == false ]]; then
  read -r -p "Type the complete backup ID to restore: " CONFIRM
  [[ "$CONFIRM" == "$BACKUP_ID" ]] || { echo "confirmation mismatch" >&2; exit 1; }
fi
"$RSYNC_BIN" "${RSYNC_ARGS[@]}" "$BACKUP_DIR/.pi-web-auth/" "$HOME_ROOT/.pi-web-auth/"
"$RSYNC_BIN" "${RSYNC_ARGS[@]}" "$BACKUP_DIR/pi-users/" "$HOME_ROOT/pi-users/"
mkdir -p "$HOME_ROOT/.pi/agent"
"$RSYNC_BIN" "${RSYNC_ARGS[@]}" "$BACKUP_DIR/.pi/agent/" "$HOME_ROOT/.pi/agent/"
echo "$( [[ "$DRY_RUN" == true ]] && echo dry-run || echo restored ): $BACKUP_ID"
