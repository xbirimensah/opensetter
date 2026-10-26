#!/usr/bin/env bash
# Nightly backup: a Postgres dump plus a snapshot of the media folder,
# with rotation. Schedule it with cron, launchd or a systemd timer
# (docs/operations.md).
#
#   scripts/backup.sh                 # values from the environment / .env
#
# Settings (environment, or read from ./.env when unset):
#   DATABASE_URL       database to dump (Prisma's ?schema= is stripped)
#   MEDIA_DIR          media folder to snapshot (default ./data/media)
#   BACKUP_DIR         where backups go (default ./backups)
#   BACKUP_KEEP_DAYS   delete backups older than this (default 14)
#   PG_DUMP_CMD        dump command instead of pg_dump, e.g. for a Docker
#                      database: "docker exec opensetter-db pg_dump -U postgres opensetter"
#   ALERT_NTFY_URL / ALERT_WEBHOOK_URL   notified when the backup fails
set -euo pipefail

cd "$(dirname "$0")/.."

# Read one KEY=value from .env without sourcing it (values may hold
# spaces and angle brackets).
env_value() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

for key in DATABASE_URL MEDIA_DIR BACKUP_DIR BACKUP_KEEP_DAYS PG_DUMP_CMD ALERT_NTFY_URL ALERT_WEBHOOK_URL; do
  if [ -z "${!key:-}" ]; then
    value="$(env_value "$key")"
    [ -n "$value" ] && export "$key=$value"
  fi
done

BACKUP_DIR="${BACKUP_DIR:-./backups}"
MEDIA_DIR="${MEDIA_DIR:-./data/media}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

notify_failure() {
  local message="OpenSetter backup failed on $(hostname) at $(date '+%Y-%m-%d %H:%M'): $1"
  echo "[backup] $message" >&2
  if [ -n "${ALERT_NTFY_URL:-}" ]; then
    curl -fsS -m 10 -H "Title: OpenSetter backup failed" -H "Priority: high" -d "$message" "$ALERT_NTFY_URL" >/dev/null || true
  fi
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 10 -H "Content-Type: application/json" \
      -d "{\"text\": \"$(printf '%s' "$message" | sed 's/"/\\"/g')\"}" "$ALERT_WEBHOOK_URL" >/dev/null || true
  fi
}
trap 'notify_failure "line $LINENO exited with status $?"' ERR

case "$BACKUP_KEEP_DAYS" in
  ''|*[!0-9]*) echo "[backup] BACKUP_KEEP_DAYS must be a whole number" >&2; exit 2 ;;
esac

mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/media"
chmod 700 "$BACKUP_DIR"

# ─── Database ────────────────────────────────────────────────────────────
dump_file="$BACKUP_DIR/db/opensetter-$STAMP.dump"
if [ -n "${PG_DUMP_CMD:-}" ]; then
  # Word splitting is intended: PG_DUMP_CMD is a command line.
  # shellcheck disable=SC2086
  $PG_DUMP_CMD --format=custom --no-owner > "$dump_file.partial"
else
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "[backup] DATABASE_URL is not set" >&2
    false
  fi
  pg_dump --format=custom --no-owner --dbname="${DATABASE_URL%%\?*}" > "$dump_file.partial"
fi
if [ ! -s "$dump_file.partial" ]; then
  echo "[backup] the dump is empty" >&2
  false
fi
mv "$dump_file.partial" "$dump_file"
chmod 600 "$dump_file"
echo "[backup] database: $dump_file ($(du -h "$dump_file" | cut -f1))"

# ─── Media ───────────────────────────────────────────────────────────────
if [ -d "$MEDIA_DIR" ]; then
  snapshot="$BACKUP_DIR/media/$STAMP"
  latest="$(find "$BACKUP_DIR/media" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' | sort | tail -n 1)"
  if command -v rsync >/dev/null 2>&1; then
    # Unchanged files are hard links to the previous snapshot, so each
    # night only costs the new media.
    if [ -n "$latest" ]; then
      rsync -a --delete --link-dest="$(cd "$latest" && pwd)" "$MEDIA_DIR/" "$snapshot.partial/"
    else
      rsync -a "$MEDIA_DIR/" "$snapshot.partial/"
    fi
  else
    mkdir -p "$snapshot.partial"
    cp -R "$MEDIA_DIR/." "$snapshot.partial/"
  fi
  mv "$snapshot.partial" "$snapshot"
  # rsync -a copies the source folder's mtime; rotation goes by mtime.
  touch "$snapshot"
  echo "[backup] media: $snapshot"
else
  echo "[backup] media: $MEDIA_DIR does not exist, skipped"
fi

# ─── Rotation ────────────────────────────────────────────────────────────
find "$BACKUP_DIR/db" -name 'opensetter-*.dump' -mtime "+$BACKUP_KEEP_DAYS" -delete
find "$BACKUP_DIR/db" -name '*.partial' -mtime +1 -delete
find "$BACKUP_DIR/media" -mindepth 1 -maxdepth 1 -type d -mtime "+$BACKUP_KEEP_DAYS" -exec rm -rf {} +
echo "[backup] done, keeping $BACKUP_KEEP_DAYS days"
