#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ENV_FILE=${PI_WEB_RELEASE_ENV:-/home/hsops/.config/pi-web-auth/release.env}
CURL_BIN=${PI_WEB_CURL_BIN:-curl}
[[ -r "$ENV_FILE" ]] || { echo "release environment is unreadable" >&2; exit 1; }
set -a
source "$ENV_FILE"
set +a
[[ -n "${PI_WEB_RELEASE_TOKEN:-}" ]] || { echo "release token is missing" >&2; exit 1; }

"$CURL_BIN" --config - <<CURL_CONFIG
silent
show-error
fail-with-body
max-time = 60
request = "POST"
url = "http://127.0.0.1:8000/api/internal/drain"
header = "Authorization: Bearer ${PI_WEB_RELEASE_TOKEN}"
CURL_CONFIG
