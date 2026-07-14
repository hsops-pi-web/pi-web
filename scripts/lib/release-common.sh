#!/usr/bin/env bash

set -Eeuo pipefail

SOURCE_ROOT=${PI_WEB_SOURCE_ROOT:-/home/hsops/pi-web-auth}
DEPLOY_ROOT=${PI_WEB_DEPLOY_ROOT:-/home/hsops/pi-web-auth-deploy}
BACKUP_ROOT=${PI_WEB_BACKUP_ROOT:-/home/hsops/pi-web-auth-backups}
NODE_BIN=${PI_WEB_NODE_BIN:-/home/hsops/.nvm/versions/node/v22.20.0/bin/node}
NPM_BIN=${PI_WEB_NPM_BIN:-/home/hsops/.nvm/versions/node/v22.20.0/bin/npm}
SYSTEMCTL_BIN=${PI_WEB_SYSTEMCTL_BIN:-systemctl}
CURL_BIN=${PI_WEB_CURL_BIN:-curl}
RSYNC_BIN=${PI_WEB_RSYNC_BIN:-rsync}
SLEEP_BIN=${PI_WEB_SLEEP_BIN:-sleep}
SERVICE_NAME=${PI_WEB_SERVICE_NAME:-pi-web-auth.service}

umask 077

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
require_dir() { [[ -d "$1" ]] || die "required directory missing: $1"; }
now_ms() {
  if [[ -n "${PI_WEB_NOW_BIN:-}" ]]; then "$PI_WEB_NOW_BIN"; else "$NODE_BIN" -e 'console.log(Math.floor(require("node:os").uptime()*1000))'; fi
}
json_log() {
  local phase=$1 result=$2 elapsed_ms=$3 detail=${4:-}
  "$NODE_BIN" -e 'const [releaseId,phase,result,elapsedMs,detail]=process.argv.slice(1); console.log(JSON.stringify({timestamp:new Date().toISOString(),releaseId,phase,result,elapsedMs:Number(elapsedMs),detail}))' \
    "${RELEASE_ID:-unknown}" "$phase" "$result" "$elapsed_ms" "$detail" | tee -a "${RELEASE_LOG:-/dev/null}" >&2
}
acquire_release_lock() {
  mkdir -p "$DEPLOY_ROOT"
  exec 9>"$DEPLOY_ROOT/release.lock"
  flock -n 9 || die "another release is already running"
}
atomic_symlink() {
  local target=$1 link=$2 temp
  temp="${link}.tmp.$$"
  ln -s "$target" "$temp"
  mv -Tf "$temp" "$link"
}

begin_outage_budget() {
  OUTAGE_STARTED_MS=$(now_ms)
  OUTAGE_DEADLINE_MS=$((OUTAGE_STARTED_MS + 60000))
  export OUTAGE_STARTED_MS OUTAGE_DEADLINE_MS
}
remaining_budget_ms() {
  local now
  now=$(now_ms)
  printf '%s\n' "$((OUTAGE_DEADLINE_MS - now))"
}
require_budget() {
  local phase=$1 minimum_ms=${2:-1} remaining
  remaining=$(remaining_budget_ms)
  (( remaining >= minimum_ms )) || die "60 second outage budget exhausted before $phase"
}
run_with_budget() {
  local phase=$1
  shift
  require_budget "$phase" 1
  local remaining seconds
  remaining=$(remaining_budget_ms)
  seconds=$(awk -v ms="$remaining" 'BEGIN { printf "%.3f", ms / 1000 }')
  timeout --foreground "${seconds}s" "$@"
}
preflight_disk_space() {
  if [[ -n "${PI_WEB_DISK_CHECK_BIN:-}" ]]; then
    "$PI_WEB_DISK_CHECK_BIN" "$PRODUCTION_HOME" "$BACKUP_ROOT"
    return
  fi
  mkdir -p "$BACKUP_ROOT"
  local required available
  required=$(du -sb \
    "$PRODUCTION_HOME/.pi-web-auth" \
    "$PRODUCTION_HOME/pi-users" \
    "$PRODUCTION_HOME/.pi/agent" | awk '{ total += $1 } END { print total }')
  available=$(df -PB1 "$BACKUP_ROOT" | awk 'NR == 2 { print $4 }')
  [[ "$required" =~ ^[0-9]+$ && "$available" =~ ^[0-9]+$ ]] || die "disk preflight returned invalid values"
  (( available >= required + required / 10 )) || die "insufficient space for verified backup"
}
release_token_curl() {
  local endpoint=$1 max_time=$2
  "$CURL_BIN" --config - <<CURL_CONFIG
silent
show-error
fail-with-body
max-time = $max_time
request = "POST"
url = "http://127.0.0.1:8000$endpoint"
header = "Authorization: Bearer ${PI_WEB_RELEASE_TOKEN}"
CURL_CONFIG
}
wait_ready() {
  local expected_release=$1 expected_commit=$2 timeout_seconds=$3
  local deadline=$(( $(now_ms) + timeout_seconds * 1000 )) consecutive=0 body
  while (( $(now_ms) < deadline )); do
    if body=$($CURL_BIN -fsS --max-time 2 http://127.0.0.1:8000/api/health/ready) && \
       printf '%s' "$body" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const [r,c]=process.argv.slice(1);const v=JSON.parse(s);process.exit(v.status==="ready"&&v.releaseId===r&&v.commit===c?0:1)})' "$expected_release" "$expected_commit"; then
      consecutive=$((consecutive + 1))
      (( consecutive >= 3 )) && return 0
    else
      consecutive=0
    fi
    "$SLEEP_BIN" 1
  done
  return 1
}
prune_releases() {
  local current previous
  current=$(readlink -f "$DEPLOY_ROOT/current")
  previous=$(readlink -f "$DEPLOY_ROOT/previous" 2>/dev/null || true)
  mapfile -t candidates < <(find "$DEPLOY_ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
  declare -A keep=()
  [[ -n "$current" && -f "$current/release.json" ]] && keep["$current"]=1
  [[ -n "$previous" && -f "$previous/release.json" ]] && keep["$previous"]=1
  local path
  for path in "${candidates[@]}"; do
    [[ -f "$path/release.json" ]] || continue
    (( ${#keep[@]} >= 4 )) && break
    keep["$path"]=1
  done
  for path in "${candidates[@]}"; do
    [[ -f "$path/release.json" ]] || continue
    [[ -n "${keep[$path]:-}" ]] || rm -rf --one-file-system "$path"
  done
}
