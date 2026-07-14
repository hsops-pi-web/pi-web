#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib/release-common.sh"

PRODUCTION_HOME=${PI_WEB_PRODUCTION_HOME:-/home/hsops}
INSTALLED_UNIT=${PI_WEB_INSTALLED_UNIT:-/home/hsops/.config/systemd/user/pi-web-auth.service}
UNIT_TEMPLATE=${PI_WEB_UNIT_TEMPLATE:-$SOURCE_ROOT/systemd/pi-web-auth.service}
ENV_FILE=${PI_WEB_RELEASE_ENV:-/home/hsops/.config/pi-web-auth/release.env}
LEGACY_NEXT=${PI_WEB_LEGACY_NEXT:-$SOURCE_ROOT/.next}
MIGRATION_ROOT=${PI_WEB_MIGRATION_ROOT:-$DEPLOY_ROOT/migration}
BACKUP_SCRIPT=${PI_WEB_BACKUP_SCRIPT:-$SCRIPT_DIR/backup-production.mjs}
OPENSSL_BIN=${PI_WEB_OPENSSL_BIN:-openssl}

if [[ -n "${PI_WEB_BACKUP_BIN:-}" ]]; then
  BACKUP_COMMAND=("$PI_WEB_BACKUP_BIN")
else
  BACKUP_COMMAND=("$NODE_BIN" "$BACKUP_SCRIPT")
fi

release_path=""
service_stopped=false
migration_succeeded=false
legacy_backup=""
release_id=""
commit=""
allow_legacy_stop=false
confirmed_release=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release) release_path=${2:-}; shift 2 ;;
    --allow-legacy-stop) allow_legacy_stop=true; shift ;;
    --confirm-no-active-replies) confirmed_release=${2:-}; shift 2 ;;
    *) die "usage: migrate-first-release.sh --release <directory> --allow-legacy-stop --confirm-no-active-replies <release-id>" ;;
  esac
done
[[ -n "$release_path" ]] || die "--release is required"
release_path=$(readlink -f "$release_path")

read_manifest() {
  "$NODE_BIN" -e '
    const fs=require("node:fs");
    const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    if(typeof value.releaseId!=="string" || typeof value.commit!=="string" || !/^[0-9a-f]{40}$/.test(value.commit)) process.exit(2);
    process.stdout.write(`${value.releaseId}\n${value.commit}\n`);
  ' "$1/release.json"
}

recover_legacy() {
  local status=$1 failed_next
  [[ "$status" -ne 0 && "$migration_succeeded" != true ]] || return 0
  set +e
  if [[ "$service_stopped" == true ]]; then
    "$SYSTEMCTL_BIN" --user stop "$SERVICE_NAME"
    cp "$legacy_backup/original.service" "$INSTALLED_UNIT"
    if [[ -e "$LEGACY_NEXT" ]]; then
      failed_next="${LEGACY_NEXT}.failed-$(date -u +%Y%m%d-%H%M%S)"
      mv "$LEGACY_NEXT" "$failed_next"
    fi
    cp -a --reflink=auto "$legacy_backup/legacy-next" "$LEGACY_NEXT"
    "$SYSTEMCTL_BIN" --user daemon-reload
    "$SYSTEMCTL_BIN" --user start "$SERVICE_NAME"
    if "$CURL_BIN" -fsS --max-time 30 http://127.0.0.1:8000/login >/dev/null; then
      json_log legacy-rollback success 0 "source-service-ready"
    else
      json_log legacy-rollback critical 0 "source-service-not-ready"
    fi
  fi
  set -e
}
trap 'recover_legacy $?' EXIT

main() {
  acquire_release_lock
  [[ "$release_path" == "$DEPLOY_ROOT/releases/"* ]] || die "release is outside managed release root"
  mapfile -t manifest < <(read_manifest "$release_path")
  [[ ${#manifest[@]} -eq 2 ]] || die "release manifest is invalid"
  release_id=${manifest[0]}
  commit=${manifest[1]}
  [[ "$allow_legacy_stop" == true ]] || die "first migration requires --allow-legacy-stop"
  [[ "$confirmed_release" == "$release_id" ]] || die "active-reply confirmation must equal the target release id"
  RELEASE_ID=$release_id
  RELEASE_LOG="$DEPLOY_ROOT/logs/$RELEASE_ID.log"
  export RELEASE_ID RELEASE_LOG PRODUCTION_HOME
  mkdir -p "$DEPLOY_ROOT/logs" "$MIGRATION_ROOT" "$(dirname "$INSTALLED_UNIT")" "$(dirname "$ENV_FILE")"

  [[ -f "$INSTALLED_UNIT" ]] || die "legacy unit is missing"
  grep -Fq "WorkingDirectory=$SOURCE_ROOT" "$INSTALLED_UNIT" || die "installed unit is not the legacy source unit"
  [[ -d "$LEGACY_NEXT" ]] || die "legacy .next is missing"
  legacy_backup="$MIGRATION_ROOT/legacy-$(date -u +%Y%m%d-%H%M%S)"
  mkdir -p "$legacy_backup"
  cp "$INSTALLED_UNIT" "$legacy_backup/original.service"
  git -C "$SOURCE_ROOT" rev-parse HEAD > "$legacy_backup/source-commit"
  cp -a --reflink=auto "$LEGACY_NEXT" "$legacy_backup/legacy-next"
  json_log legacy-backup success 0 "unit-and-next-copied"

  if [[ ! -e "$ENV_FILE" ]]; then
    local register_keyword token
    register_keyword=$(sed -n 's/^Environment=REGISTER_KEYWORD=//p' "$INSTALLED_UNIT" | tail -n 1)
    [[ -n "$register_keyword" ]] || die "legacy REGISTER_KEYWORD is missing"
    token=$($OPENSSL_BIN rand -hex 32)
    [[ "$token" =~ ^[0-9a-f]{64}$ ]] || die "release token generation failed"
    printf 'PI_WEB_RELEASE_TOKEN=%s\nREGISTER_KEYWORD=%s\n' "$token" "$register_keyword" > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi
  [[ "$(stat -c %a "$ENV_FILE")" == 600 ]] || die "release environment must have mode 600"
  set -a
  source "$ENV_FILE"
  set +a
  [[ -n "${PI_WEB_RELEASE_TOKEN:-}" && -n "${REGISTER_KEYWORD:-}" ]] || die "release environment is incomplete"

  preflight_disk_space
  "${BACKUP_COMMAND[@]}" prepare \
    --home "$PRODUCTION_HOME" \
    --backup-root "$BACKUP_ROOT" \
    --backup-id "$release_id" \
    --release-id "$release_id" \
    --commit "$commit" >/dev/null

  begin_outage_budget
  require_budget legacy-stop 10000
  local legacy_stop_started
  legacy_stop_started=$(now_ms)
  service_stopped=true
  run_with_budget legacy-stop "$SYSTEMCTL_BIN" --user stop "$SERVICE_NAME"
  json_log legacy_stop success "$(( $(now_ms) - legacy_stop_started ))" "drain-unavailable-one-time-exception"
  require_budget finalize-backup 3000
  run_with_budget finalize-backup \
    "${BACKUP_COMMAND[@]}" finalize \
    --home "$PRODUCTION_HOME" \
    --backup-root "$BACKUP_ROOT" \
    --backup-id "$release_id" \
    --release-id "$release_id" \
    --commit "$commit" >/dev/null
  require_budget first-switch 1

  atomic_symlink "$release_path" "$DEPLOY_ROOT/current"
  install -m 0644 "$UNIT_TEMPLATE" "$INSTALLED_UNIT"
  "$SYSTEMCTL_BIN" --user daemon-reload
  "$SYSTEMCTL_BIN" --user start "$SERVICE_NAME"
  wait_ready "$release_id" "$commit" 30

  "$NODE_BIN" -e '
    const fs=require("node:fs"), path=require("node:path");
    const [target,legacyBackup]=process.argv.slice(1);
    const temp=`${target}.tmp`;
    fs.writeFileSync(temp,JSON.stringify({legacyBackup:path.basename(legacyBackup),standaloneSuccesses:1,rollbackDrillPassed:false},null,2)+"\n",{mode:0o600});
    fs.renameSync(temp,target);
  ' "$MIGRATION_ROOT/status.json" "$legacy_backup"
  migration_succeeded=true
  json_log first-migration success "$(( $(now_ms) - OUTAGE_STARTED_MS ))" "standalone-ready"
  printf 'migrated %s (%s)\n' "$release_id" "$commit"
}

main "$@"
