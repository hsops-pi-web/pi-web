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
  local target=$1 link=$2 temp="${link}.tmp.$$"
  ln -s "$target" "$temp"
  mv -Tf "$temp" "$link"
}
