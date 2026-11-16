# PowerShell seminar demos

Use Windows PowerShell 5.1 or PowerShell 7 with Docker Desktop running Linux
containers. Compose 2.24.4+ is needed for the phase-8 overlay. Run on the final
branch/tag to have every script available.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/seminar/09-redis.ps1
```

Bypass applies only to this child process, not machine policy. Every numbered step
prints its purpose, waits for Enter, then runs. The next prompt is a presentation
break. Q stops before an action; Ctrl+C interrupts execution. Exiting does not
remove the stack. Redis outage checks restore Redis in `finally` on ordinary errors.

| Script | Purpose and prerequisites |
|---|---|
| 00-local.ps1 | Existing backend/.venv, configured local PostgreSQL; start the local API in another terminal before its final step |
| 00-reset.ps1 | Preview/reset seminar resources; see reset instructions below |
| 01-problem.ps1 | Python on PATH; create ignored .venv-empty with no packages |
| 02-concepts.ps1 | Alpine image and short-lived process lifecycle |
| 03-image.ps1 | Build backend, run without publishing a host port, stop/start |
| 04-ports.ps1 | Continue phase 3; replace backend with published port |
| 05-registry-db.ps1 | Pull PostgreSQL, mount init SQL, wait and inspect schema |
| 06-network.ps1 | Continue phases 4-5; Docker DNS and real API smoke tests |
| 07-volume.ps1 | Continue phase 6; delete disposable data, prove named-volume persistence, export backup |
| 08-compose.ps1 | Stop manual containers; run three application services with Redis disabled |
| 09-redis.ps1 | MISS/HIT, outage, invalidation, expiration and integration checks |
| 10-architecture.ps1 | Networks, volume, direct/proxied HTTP tests, CI explanation |
| 11-final.ps1 | Final architecture, tests, recreation and persistence |
| test-scripts.ps1 | Parse scripts; verify listing, skipping and command failure handling without mutations |

Scripts are teaching sequences. Run manual phases 2-7 once in order after reset.
Name conflicts stop execution instead of silently removing an existing container.
Manual database credentials are shortener_user/shortener_password, database
url_shortener. Compose uses its POSTGRES_* settings. Changing initialized
credentials also requires updating the stored database.

## Select steps and rehearse

```powershell
# No demo actions, commands or HTTP requests are executed by ListSteps.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/seminar/09-redis.ps1 -ListSteps

# Section 9.6 creates independent records.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/seminar/09-redis.ps1 -FromStep 5

# Automated rehearsal deliberately skips all presentation pauses.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/seminar/09-redis.ps1 -NonInteractive

powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/seminar/test-scripts.ps1
```

FromStep skips actions; it does not restore in-memory variables. For the phase-9
HIT step start at step 2. For phase-11 persistence start at step 3. Interrupted runs
can leave demo records; later runs create fresh codes. Normal tests remove their
own records. These scripts are for demo environments, not production databases.

To use an isolated Compose project and port:

```powershell
$env:SEMINAR_HTTP_PORT = '18080'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/seminar/09-redis.ps1 `
  -ProjectName url-shortener-verify -BaseUrl http://localhost:18080
Remove-Item Env:SEMINAR_HTTP_PORT
```

Set the port consistently for every invocation. BaseUrl alone does not change the
published Docker port. Compose paths are resolved from the repository. Project
names isolate networks and volumes; image tags are shared between projects.
Manual phases accept Prefix (for example seminar-verify), BackendPort, and/or
DatabasePort where relevant. Keep these values consistent across related phases.

The phase-8 overlay disables Redis; phase 9 uses the main Compose file alone.
Do not run phase 8 over a phase-9 project without resetting or choosing another
project: an already running Redis container would remain.

## Reset before phase 0

Default invocation previews resources and removes nothing:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/seminar/00-reset.ps1
```

Remove seminar containers/networks/application image tags, keeping database volumes:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/seminar/00-reset.ps1 -Apply
```

Prepare all phases from empty seminar data, including the image-pull lesson:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/seminar/00-reset.ps1 `
  -Apply -DeleteData -IncludeBaseImages
```

DeleteData erases the selected Compose and manual seminar database volumes. Preview
first; preserve a backup if those records matter. Interactive execution requires
RESET, then still pauses before each step. NonInteractive only mutates Docker
when Apply is also explicitly selected.

Reset selects Compose containers by exact project label, manual containers by an
exact allowlist under Prefix, their networks, and their database volumes. It removes
application image tags across phases, including local backend registry aliases.
Optional base-image removal targets only six seminar image references. Images used
by any remaining containers are reported and skipped; image removal never uses
force. There is no global system/volume/builder prune. Other projects, local
PostgreSQL, source files and Git tags are retained.

Builder cache remains shared state. Removing tags does not ensure a cold build;
use docker build --no-cache for that separate lesson. Package cache mounts can
still reuse downloads. Shared image references may intentionally remain.

## Git snapshots

```powershell
.\scripts\switch-tag.ps1
git switch feature/docker
```

Historical tags predate these new scripts and are preserved rather than rewritten.
For historical inspection, create a sibling worktree from a clean final checkout:

```powershell
git worktree add --detach ../url-shortener-phase08 seminar/08-compose
```

Copy scripts from the final checkout if needed, but older tags have different
prerequisites. The phase-8 convenience script uses the final branch overlay; at
historical phase 8 use that checkout's three-service Compose commands directly.
Earlier scripts build current source as teaching aids; tag checkouts show the
actual historical files. No demo script switches Git or resets data implicitly.
