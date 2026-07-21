#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/release-common.sh"

CLEANUP_WORKTREE=""

cleanup_worktree() {
  if [[ -n "$CLEANUP_WORKTREE" ]]; then
    git -C "$SOURCE_ROOT" worktree remove --force "$CLEANUP_WORKTREE" >/dev/null 2>&1 || true
  fi
}

copy_runtime_dependency_closure() {
  local source_root=$1 target_root=$2 package_name package_path target_path target_dir
  shift 2
  "$NODE_BIN" - "$source_root" "$@" <<'NODE' | while IFS= read -r package_name; do
const { dirname } = require("node:path");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const sourceRoot = process.argv[2];
const roots = process.argv.slice(3);
const seen = new Set();

function visit(name) {
  if (seen.has(name)) return;
  seen.add(name);
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(sourceRoot, "node_modules", ...name.split("/"), "package.json"), "utf8"));
  } catch {
    return;
  }
  for (const dep of Object.keys(pkg.dependencies || {})) visit(dep);
}

for (const root of roots) visit(root);
for (const name of seen) process.stdout.write(`${name}\n`);
NODE
    package_path="$source_root/node_modules/$package_name"
    target_path="$target_root/node_modules/$package_name"
    target_dir=$(dirname "$target_path")
    [[ -d "$package_path" ]] || die "runtime dependency missing: $package_name"
    mkdir -p "$target_dir"
    rm -rf "$target_path"
    cp -a "$package_path" "$target_path"
  done
}

main() {
  local test_mode=false
  if [[ "${NODE_ENV:-}" == test && "${PI_WEB_ALLOW_TEST_SOURCE:-}" == 1 ]]; then test_mode=true; fi
  if [[ "${PI_WEB_ALLOW_TEST_SOURCE:-0}" == 1 && "$test_mode" != true ]]; then
    die "test source override is forbidden outside NODE_ENV=test"
  fi
  if [[ "${PI_WEB_SKIP_BUILD_FOR_TEST:-0}" == 1 && "$test_mode" != true ]]; then
    die "test build override is forbidden outside NODE_ENV=test"
  fi

  git -C "$SOURCE_ROOT" rev-parse --git-dir >/dev/null || die "release source is not a git worktree"
  local branch commit short_sha
  commit=$(git -C "$SOURCE_ROOT" rev-parse HEAD)
  short_sha=${commit:0:7}
  if [[ "$test_mode" != true ]]; then
    branch=$(git -C "$SOURCE_ROOT" symbolic-ref --short HEAD 2>/dev/null || true)
    [[ "$branch" == main ]] || die "release source must be clean main"
    [[ -z "$(git -C "$SOURCE_ROOT" status --porcelain)" ]] || die "release source must be clean main"
  fi

  RELEASE_ID=${RELEASE_ID:-$(date -u +%Y%m%d-%H%M%S)-$short_sha}
  export RELEASE_ID
  local worktree="$DEPLOY_ROOT/staging/worktree-$RELEASE_ID"
  local stage="$DEPLOY_ROOT/staging/.incomplete-$RELEASE_ID"
  local failed="$DEPLOY_ROOT/staging/.failed-$RELEASE_ID"
  local final="$DEPLOY_ROOT/releases/$RELEASE_ID"
  mkdir -p "$DEPLOY_ROOT/staging" "$DEPLOY_ROOT/releases" "$DEPLOY_ROOT/logs"
  [[ ! -e "$final" ]] || die "release already exists: $RELEASE_ID"

  CLEANUP_WORKTREE="$worktree"
  trap cleanup_worktree EXIT

  if [[ "${PI_WEB_SKIP_BUILD_FOR_TEST:-0}" == 1 && "$test_mode" == true ]]; then
    mkdir -p "$stage/.next/static" "$stage/public" "$stage/.pi/extensions" "$stage/scripts"
    printf 'test server\n' > "$stage/server.js"
  else
    git -C "$SOURCE_ROOT" worktree add --detach "$worktree" "$commit"
    (cd "$worktree" && "$NPM_BIN" ci)
    (cd "$worktree" && "$NPM_BIN" run verify)
    (cd "$worktree" && "$NPM_BIN" run build)
    mkdir -p "$stage/.next" "$stage/.pi" "$stage/scripts"
    cp -a "$worktree/.next/standalone/." "$stage/"
    cp -a "$worktree/.next/static" "$stage/.next/static"
    cp -a "$worktree/public" "$stage/public"
    cp -a "$worktree/.pi/extensions" "$stage/.pi/extensions"
    copy_runtime_dependency_closure "$worktree" "$stage" \
      "@modelcontextprotocol/sdk" \
      "@z_ai/mcp-server" \
      "typebox" \
      "zod"
    cp "$worktree/scripts/systemd-stop.sh" "$stage/scripts/systemd-stop.sh"
  fi

  "$NODE_BIN" -e 'const fs=require("node:fs"); const [path,releaseId,commit,appVersion,piVersion]=process.argv.slice(1); fs.writeFileSync(path, JSON.stringify({releaseId,commit,builtAt:new Date().toISOString(),nodeVersion:process.version,appVersion,piVersion},null,2)+"\n", {mode:0o600})' \
    "$stage/release.json" "$RELEASE_ID" "$commit" \
    "$("$NODE_BIN" -p "require('$SOURCE_ROOT/package.json').version")" \
    "$("$NODE_BIN" -p "require('$SOURCE_ROOT/node_modules/@earendil-works/pi-coding-agent/package.json').version")"

  local verifier=${PI_WEB_STANDALONE_VERIFY_BIN:-$SOURCE_ROOT/scripts/verify-standalone.mjs}
  local verify_home="$DEPLOY_ROOT/staging/home-$RELEASE_ID"
  local verify_port=${PI_WEB_STAGING_PORT:-18145}
  if ! "$NODE_BIN" "$verifier" "$stage" "$verify_home" "$verify_port" "$RELEASE_ID" "$commit"; then
    mv "$stage" "$failed"
    printf 'staging-verify\n' > "$failed/failure-stage"
    return 23
  fi
  mv "$stage" "$final"
  rm -rf "$verify_home"
  printf '%s\n' "$final"
}

main "$@"
