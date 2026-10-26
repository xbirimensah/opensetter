# Operations

Running OpenSetter yourself: alerts, backups and health.

## Health

`GET /api/health` answers 200 `{"status":"ok"}` or 503 `degraded`. From
the server itself (or with `x-health-token: $HEALTH_TOKEN`) it lists each
check: database, Redis, queue and the worker heartbeat.

Point an external uptime monitor (UptimeRobot, Better Stack, a cron on
another machine) at the public `/api/health`. It is the only thing that
notices when the whole machine is down.

## Alerts

Set any of these and the instance pushes problems to you:

| Variables | Channel |
|---|---|
| `ALERT_NTFY_URL` (+ `ALERT_NTFY_TOKEN`) | [ntfy](https://ntfy.sh) topic, phone push |
| `ALERT_TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID` | Telegram bot message |
| `ALERT_WEBHOOK_URL` | Slack-style incoming webhook (`{"text": ...}`) |
| `ALERT_EMAIL_TO` | Email through Resend (`RESEND_API_KEY`) |

What is sent:

- **Health check failing:** the web server runs the health checks every
  2 minutes (`ALERT_HEALTH_INTERVAL_MS`) and alerts after two failures in
  a row, then once more when it recovers. `ALERT_HEALTH_WATCH=off` turns
  this off.
- **DM worker job failed:** at most one per hour; the Diagnostics page
  lists them all.
- **Token refresh failed:** per Instagram account, from the daily cron.

Repeats of the same alert are dropped for an hour
(`ALERT_DEDUPE_SECONDS`).

## Backups

`npm run backup` (or `scripts/backup.sh`) writes a Postgres dump and a
snapshot of the media folder to `BACKUP_DIR` (default `./backups`) and
deletes backups older than `BACKUP_KEEP_DAYS` (default 14). Media
snapshots hard-link unchanged files, so each night costs only new media.
On failure it exits non-zero and notifies `ALERT_NTFY_URL` or
`ALERT_WEBHOOK_URL`.

It needs `pg_dump` on the host, or a dump command for a database in
Docker:

```bash
PG_DUMP_CMD="docker exec opensetter-db pg_dump -U postgres opensetter"
```

Run it nightly, for example with cron:

```cron
30 3 * * * cd /srv/opensetter && npm run backup >> logs/backup.log 2>&1
```

or a launchd agent on macOS with `StartCalendarInterval` (Hour 3,
Minute 30) running `/bin/bash scripts/backup.sh`.

Restore a dump into an empty database:

```bash
pg_restore --no-owner --dbname "$DATABASE_URL" backups/db/opensetter-YYYYMMDD-HHMMSS.dump
```

Copy the backup folder off the machine too (another disk, rsync to a
second host, object storage); a backup on the same disk does not survive
the disk.
