#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib/release-common.sh"

ENV_FILE=${PI_WEB_RELEASE_ENV:-/home/hsops/.config/pi-web-auth/release.env}
PRODUCTION_HOME=${PI_WEB_PRODUCTION_HOME:-/home/hsops}
BUILD_RELEASE_BIN=${PI_WEB_BUILD_RELEASE_BIN:-$SCRIPT_DIR/build-release.sh}
BACKUP_SCRIPT=${PI_WEB_BACKUP_SCRIPT:-$SCRIPT_DIR/backup-production.mjs}

service_stopped=false
previous_switched=false
links_switched=false
drain_started=false
release_succeeded=false
old_current=""
old_previous=""
old_release_id=""
old_commit=""
new_release=""
commit=""

if [[ -n "${PI_WEB_BACKUP_BIN:-}" ]]; then
  BACKUP_COMMAND=("$PI_WEB_BACKUP_BIN")
else
  BACKUP_COMMAND=("$NODE_BIN" "$BACKUP_SCRIPT")
fi
backup_command() {
  "${BACKUP_COMMAND[@]}" "$@"
}

record_standalone_success() {
  local status_file="$DEPLOY_ROOT/migration/status.json"
  [[ -f "$status_file" ]] || return 0
  "$NODE_BIN" -e '
    const fs=require("node:fs");
    const path=process.argv[1], value=JSON.parse(fs.readFileSync(path,"utf8"));
    value.standaloneSuccesses=Number(value.standaloneSuccesses||0)+1;
    const temp=`${path}.tmp`;
    fs.writeFileSync(temp,JSON.stringify(value,null,2)+"\n",{mode:0o600});
    fs.renameSync(temp,path);
  ' "$status_file"
}

read_manifest() {
  "$NODE_BIN" -e '
    const fs=require("node:fs");
    const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    if(typeof value.releaseId!=="string" || typeof value.commit!=="string" || !/^[0-9a-f]{40}$/.test(value.commit)) process.exit(2);
    process.stdout.write(`${value.releaseId}\n${value.commit}\n`);
  ' "$1/release.json"
}

restore_previous_link() {
  if [[ -n "$old_previous" ]]; then
    atomic_symlink "$old_previous" "$DEPLOY_ROOT/previous"
  else
    rm -f "$DEPLOY_ROOT/previous"
  fi
}

recover_failed_release() {
  local status=$1 recovery_started recovery_elapsed
  [[ "$status" -ne 0 && "$release_succeeded" != true ]] || return 0
  set +e
  recovery_started=$(now_ms)
  if [[ "$links_switched" == true ]]; then
    json_log rollback start 0 "restore-previous"
    "$SYSTEMCTL_BIN" --user stop "$SERVICE_NAME"
    atomic_symlink "$old_current" "$DEPLOY_ROOT/current"
    restore_previous_link
    "$SYSTEMCTL_BIN" --user start "$SERVICE_NAME"
    if wait_ready "$old_release_id" "$old_commit" 30; then
      recovery_elapsed=$(( $(now_ms) - recovery_started ))
      json_log rollback success "$recovery_elapsed" "previous-ready"
    else
      recovery_elapsed=$(( $(now_ms) - recovery_started ))
      json_log rollback critical "$recovery_elapsed" "previous-not-ready"
      printf 'CRITICAL: new and previous releases are not ready; preserve releases, backup, and log\n' >&2
    fi
  elif [[ "$service_stopped" == true ]]; then
    [[ "$previous_switched" == true ]] && restore_previous_link
    "$SYSTEMCTL_BIN" --user start "$SERVICE_NAME"
    if wait_ready "$old_release_id" "$old_commit" 30; then
      recovery_elapsed=$(( $(now_ms) - recovery_started ))
      json_log recovery success "$recovery_elapsed" "old-service-ready"
    else
      recovery_elapsed=$(( $(now_ms) - recovery_started ))
      json_log recovery critical "$recovery_elapsed" "old-service-not-ready"
    fi
  elif [[ "$drain_started" == true ]]; then
    if release_token_curl /api/internal/resume 5 >/dev/null; then
      recovery_elapsed=$(( $(now_ms) - recovery_started ))
      json_log resume success "$recovery_elapsed" "old-process-running"
    else
      recovery_elapsed=$(( $(now_ms) - recovery_started ))
      json_log resume failed "$recovery_elapsed" "manual-check-required"
    fi
  fi
  set -e
}
trap 'recover_failed_release $?' EXIT

main() {
  [[ $# -eq 0 ]] || die "release-production.sh does not accept legacy migration arguments"
  acquire_release_lock
  [[ -r "$ENV_FILE" ]] || die "release environment is unreadable"
  [[ "$(stat -c %a "$ENV_FILE")" == 600 ]] || die "release environment must have mode 600"
  set -a
  source "$ENV_FILE"
  set +a
  [[ -n "${PI_WEB_RELEASE_TOKEN:-}" && -n "${REGISTER_KEYWORD:-}" ]] || die "release environment is incomplete"

  mkdir -p "$DEPLOY_ROOT/logs" "$DEPLOY_ROOT/releases" "$BACKUP_ROOT"
  RELEASE_ID="pending-$$"
  RELEASE_LOG="$DEPLOY_ROOT/logs/$RELEASE_ID.log"
  export RELEASE_ID RELEASE_LOG PRODUCTION_HOME
  local phase_started
  phase_started=$(now_ms)
  new_release=$("$BUILD_RELEASE_BIN")
  new_release=$(readlink -f "$new_release")
  [[ "$new_release" == "$DEPLOY_ROOT/releases/"* ]] || die "build returned a release outside deploy root"
  mapfile -t new_manifest < <(read_manifest "$new_release")
  [[ ${#new_manifest[@]} -eq 2 ]] || die "new release manifest is invalid"
  RELEASE_ID=${new_manifest[0]}
  commit=${new_manifest[1]}
  mv "$RELEASE_LOG" "$DEPLOY_ROOT/logs/$RELEASE_ID.log" 2>/dev/null || true
  RELEASE_LOG="$DEPLOY_ROOT/logs/$RELEASE_ID.log"
  export RELEASE_ID RELEASE_LOG
  json_log build success "$(( $(now_ms) - phase_started ))" "staging-verified"

  old_current=$(readlink -f "$DEPLOY_ROOT/current")
  [[ "$old_current" == "$DEPLOY_ROOT/releases/"* ]] || die "current is not a managed release"
  mapfile -t old_manifest < <(read_manifest "$old_current")
  [[ ${#old_manifest[@]} -eq 2 ]] || die "current release manifest is invalid"
  old_release_id=${old_manifest[0]}
  old_commit=${old_manifest[1]}
  old_previous=$(readlink -f "$DEPLOY_ROOT/previous" 2>/dev/null || true)

  phase_started=$(now_ms)
  preflight_disk_space
  json_log disk-check success "$(( $(now_ms) - phase_started ))" "space-available"
  phase_started=$(now_ms)
  backup_command prepare \
    --home "$PRODUCTION_HOME" \
    --backup-root "$BACKUP_ROOT" \
    --backup-id "$RELEASE_ID" \
    --release-id "$RELEASE_ID" \
    --commit "$commit" >/dev/null
  json_log pre-backup success "$(( $(now_ms) - phase_started ))" "online-copy-complete"

  begin_outage_budget
  drain_started=true
  phase_started=$(now_ms)
  release_token_curl /api/internal/drain 35 >/dev/null
  json_log drain success "$(( $(now_ms) - phase_started ))" "sessions-drained"

  require_budget stop 10000
  phase_started=$(now_ms)
  service_stopped=true
  run_with_budget stop "$SYSTEMCTL_BIN" --user stop "$SERVICE_NAME"
  json_log stop success "$(( $(now_ms) - phase_started ))" "old-service-stopped"

  require_budget finalize-backup 3000
  phase_started=$(now_ms)
  run_with_budget finalize-backup \
    "${BACKUP_COMMAND[@]}" finalize \
    --home "$PRODUCTION_HOME" \
    --backup-root "$BACKUP_ROOT" \
    --backup-id "$RELEASE_ID" \
    --release-id "$RELEASE_ID" \
    --commit "$commit" >/dev/null
  json_log finalize-backup success "$(( $(now_ms) - phase_started ))" "verified"
  require_budget switch 1

  phase_started=$(now_ms)
  atomic_symlink "$old_current" "$DEPLOY_ROOT/previous"
  previous_switched=true
  atomic_symlink "$new_release" "$DEPLOY_ROOT/current"
  links_switched=true
  json_log symlink-switch success "$(( $(now_ms) - phase_started ))" "current-updated"

  phase_started=$(now_ms)
  "$SYSTEMCTL_BIN" --user start "$SERVICE_NAME"
  json_log start success "$(( $(now_ms) - phase_started ))" "new-service-started"
  phase_started=$(now_ms)
  wait_ready "$RELEASE_ID" "$commit" 30
  json_log health-check success "$(( $(now_ms) - phase_started ))" "three-consecutive-ready"
  release_succeeded=true

  phase_started=$(now_ms)
  if record_standalone_success; then
    json_log migration-status success "$(( $(now_ms) - phase_started ))" "standalone-success-recorded"
  else
    json_log migration-status warning "$(( $(now_ms) - phase_started ))" "manual-status-update-required"
  fi

  phase_started=$(now_ms)
  if backup_command retention --backup-root "$BACKUP_ROOT" >/dev/null && prune_releases; then
    json_log retention success "$(( $(now_ms) - phase_started ))" "policy-applied"
  else
    json_log retention warning "$(( $(now_ms) - phase_started ))" "manual-cleanup-required"
  fi
  printf 'released %s (%s)\n' "$RELEASE_ID" "$commit"
}

main "$@"
