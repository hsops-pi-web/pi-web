# Session Workspace Temporary Integration Flow

Status: active until `feat/session-workspace-experience` is merged back to `main`.

This document is required reading before P2 development, P3 development, every merge back into the temporary integration branch, and the final merge back to `main`.

## Purpose

`feat/session-workspace-experience` is the temporary integration branch for the full session/workspace product line. P1 is complete on this branch. P2 and P3 must build on it without touching production `main` until the whole product line has passed final verification.

This branch is not a production release branch. Treat it as the stable development baseline for the P1/P2/P3 sequence.

## Branch Roles

- `main`: production source branch. Keep clean. Do not develop P2/P3 directly on it.
- `feat/session-workspace-experience`: temporary integration branch. Holds P1 plus accepted P2/P3 work.
- P2 feature branch: fork from `feat/session-workspace-experience`, implement administrator observability, validate, then merge back into `feat/session-workspace-experience`.
- P3 feature branch: fork from the updated `feat/session-workspace-experience`, implement model and tool usage experience, validate, then merge back into `feat/session-workspace-experience`.

Use descriptive child branch names, for example:

```bash
feat/session-workspace-admin-observability
feat/session-workspace-model-tool-experience
```

## Required Worktree And Service Rules

All P2/P3 work must use a linked worktree and a non-8000 user systemd dev service.

- Production worktree: `/home/hsops/pi-web-auth`, branch `main`, port 8000. Do not use it for feature development.
- Integration worktree: keep `feat/session-workspace-experience` available as the temporary baseline.
- Feature worktree: create a new linked worktree for each P2/P3 branch.
- Dev service: run feature acceptance through a user systemd service, not a transient shell dev server.
- Data isolation: use a dedicated `HOME` for each feature service so `.pi-web-auth`, `.pi/agent`, and `pi-users` do not share production data.
- Never run `next build` in a development worktree.

The P1 dev service pattern is the reference:

```text
pi-web-auth-8144-dev.service
WorkingDirectory=/home/hsops/pi-web-auth/.worktrees/session-workspace-experience
HOME=/home/hsops/.pi-session-workspace-dev-home
PORT=8144
```

For P2/P3, use a distinct port, service name, worktree path, and isolated HOME unless intentionally reusing the integration service for integration-only smoke testing.

## Development Sequence

### Start P2 Or P3

1. Read this document.
2. Confirm `/home/hsops/pi-web-auth` is on clean `main`.
3. Confirm `feat/session-workspace-experience` is the current integration baseline.
4. Create a child branch from `feat/session-workspace-experience`.
5. Create or update a dedicated user systemd service for the child worktree.
6. Run development and acceptance only on the child service port.

### Finish A Child Branch

Before merging a child branch back into `feat/session-workspace-experience`:

1. Read this document again.
2. Run the project verification gate required by the child plan.
3. Run UI smoke or real administrator UI tests when the change affects UI behavior.
4. Check the child service logs with `journalctl --user -u <service> --since '10 minutes ago' --no-pager`.
5. Confirm no production port 8000 behavior was changed during development.
6. Merge the child branch into `feat/session-workspace-experience` only after validation is clean.
7. Run a minimal integration gate on `feat/session-workspace-experience` after the merge.

### Final Merge To Main

Before merging `feat/session-workspace-experience` back to `main`:

1. Read this document.
2. Confirm P1, P2, and P3 are all complete and merged into `feat/session-workspace-experience`.
3. Run the full verification gate from the integration branch.
4. Run administrator UI smoke tests and observe the integration service logs.
5. Review production release requirements in `docs/operations/production-release.md`.
6. Merge to clean `main` only after full validation passes.
7. Follow the production release process; do not manually run production from the source worktree.

## Data Safety

Feature services must not use production data paths.

Production uses the normal user home:

```text
/home/hsops/.pi-web-auth/auth.db
/home/hsops/.pi-web-auth/session-index.db
/home/hsops/.pi/agent/
/home/hsops/pi-users/
```

Development services must use isolated HOME paths, for example:

```text
/home/hsops/.pi-session-workspace-dev-home/.pi-web-auth/auth.db
/home/hsops/.pi-session-workspace-dev-home/.pi-web-auth/session-index.db
/home/hsops/.pi-session-workspace-dev-home/.pi/agent/
/home/hsops/.pi-session-workspace-dev-home/pi-users/
```

Browser cookies can still be shared across ports on the same host. If login state looks inconsistent between services, clear the browser cookie for the host or use an isolated browser profile before assuming server data is mixed.

## Scope Guard

P1 is complete on `feat/session-workspace-experience`.

- P2 scope: administrator observability.
- P3 scope: model and tool usage experience.

Do not add unrelated product work to the integration branch while P2/P3 are in progress. Put unrelated ideas into a new spec or backlog item.

## Minimum Checks

Use the stricter plan-specific gate when a plan defines one. At minimum, run:

```bash
npm run lint
npm run typecheck
npm run test:auth
npm run test:ui
npm run test:release
systemctl --user status <dev-service>.service --no-pager
journalctl --user -u <dev-service>.service --since '10 minutes ago' --no-pager
```

For final integration before merging to `main`, run `npm run verify` unless a known environment constraint requires splitting it into equivalent commands.

