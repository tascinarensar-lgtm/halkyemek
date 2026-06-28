#!/usr/bin/env bash
set -euo pipefail

umask 077

timestamp() {
  date +"%Y-%m-%dT%H:%M:%S%z"
}

log() {
  echo "[$(timestamp)] [backup_postgres] $*"
}

resolve_connection_mode() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    CONNECTION_MODE="uri"
    return
  fi

  if [[ -n "${PGDATABASE:-}" || -n "${PGUSER:-}" || -n "${PGHOST:-}" || -n "${PGPASSWORD:-}" ]]; then
    CONNECTION_MODE="pgenv"
    return
  fi

  : "${POSTGRES_DB:?POSTGRES_DB is required when DATABASE_URL/PG* are not set}"
  : "${POSTGRES_USER:?POSTGRES_USER is required when DATABASE_URL/PG* are not set}"
  : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required when DATABASE_URL/PG* are not set}"
  CONNECTION_MODE="legacy"
}

configure_connection_env() {
  : "${POSTGRES_PORT:=5432}"
  : "${POSTGRES_SSLMODE:=prefer}"
  : "${POSTGRES_CONNECT_TIMEOUT:=10}"
  : "${BACKUP_DIR:=/backups}"
  : "${BACKUP_RETENTION_DAYS:=14}"
  : "${BACKUP_MIN_BYTES:=128}"

  export PGSSLMODE="${PGSSLMODE:-${POSTGRES_SSLMODE}}"
  export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-${POSTGRES_CONNECT_TIMEOUT}}"

  case "${CONNECTION_MODE}" in
    uri)
      DB_LABEL="${BACKUP_DB_LABEL:-database}"
      ;;
    pgenv)
      export PGHOST="${PGHOST:-localhost}"
      export PGPORT="${PGPORT:-${POSTGRES_PORT}}"
      export PGUSER="${PGUSER:?PGUSER is required when using PG* variables}"
      export PGDATABASE="${PGDATABASE:?PGDATABASE is required when using PG* variables}"
      export PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}"
      DB_LABEL="${PGDATABASE}"
      ;;
    legacy)
      export PGHOST="${POSTGRES_HOST:-localhost}"
      export PGPORT="${POSTGRES_PORT}"
      export PGUSER="${POSTGRES_USER}"
      export PGDATABASE="${POSTGRES_DB}"
      export PGPASSWORD="${POSTGRES_PASSWORD}"
      DB_LABEL="${POSTGRES_DB}"
      ;;
    *)
      echo "Unknown connection mode: ${CONNECTION_MODE}" >&2
      exit 1
      ;;
  esac
}

pg_ready() {
  case "${CONNECTION_MODE}" in
    uri)
      pg_isready -d "${DATABASE_URL}" >/dev/null
      ;;
    *)
      pg_isready -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" >/dev/null
      ;;
  esac
}

run_pg_dump() {
  case "${CONNECTION_MODE}" in
    uri)
      pg_dump \
        --dbname="${DATABASE_URL}" \
        --format=plain \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges
      ;;
    *)
      pg_dump \
        -h "${PGHOST}" \
        -p "${PGPORT}" \
        -U "${PGUSER}" \
        -d "${PGDATABASE}" \
        --format=plain \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges
      ;;
  esac
}

prune_old_backups() {
  local backup_dir="$1"
  local retention_days="$2"

  if [[ "${retention_days}" =~ ^[0-9]+$ ]] && (( retention_days >= 0 )); then
    local before_count after_count
    before_count="$(find "${backup_dir}" -maxdepth 1 -type f -name '*.sql.gz' | wc -l | tr -d ' ')"
    find "${backup_dir}" -maxdepth 1 -type f -name '*.sql.gz' -mtime +"${retention_days}" -print -delete || true
    find "${backup_dir}" -maxdepth 1 -type f -name '*.sha256' -mtime +"${retention_days}" -print -delete || true
    after_count="$(find "${backup_dir}" -maxdepth 1 -type f -name '*.sql.gz' | wc -l | tr -d ' ')"
    log "Retention applied: kept ${after_count} backup(s), previously ${before_count}, threshold ${retention_days} day(s)"
  else
    log "Retention skipped: BACKUP_RETENTION_DAYS='${retention_days}' is invalid"
  fi
}

main() {
  resolve_connection_mode
  configure_connection_env

  mkdir -p "${BACKUP_DIR}"

  local stamp out_arg out tmp_out size_bytes
  stamp="$(date +%Y%m%d_%H%M%S)"
  out_arg="${1:-}"

  if [[ -n "${out_arg}" ]]; then
    out="${out_arg}"
  else
    out="${BACKUP_DIR%/}/backup_${DB_LABEL}_${stamp}.sql.gz"
  fi

  tmp_out="${out}.tmp"

  cleanup() {
    rm -f "${tmp_out}"
  }

  trap cleanup EXIT

  log "Starting backup target=${out} mode=${CONNECTION_MODE}"
  pg_ready

  run_pg_dump | gzip -9 > "${tmp_out}"

  gzip -t "${tmp_out}"
  mv "${tmp_out}" "${out}"

  if stat --version >/dev/null 2>&1; then
    size_bytes="$(stat -c '%s' "${out}")"
  else
    size_bytes="$(wc -c < "${out}" | tr -d ' ')"
  fi

  if [[ -z "${size_bytes}" || ! "${size_bytes}" =~ ^[0-9]+$ || "${size_bytes}" -lt "${BACKUP_MIN_BYTES}" ]]; then
    echo "Backup file is unexpectedly small: ${out} (${size_bytes:-unknown} bytes)" >&2
    exit 1
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${out}" > "${out}.sha256"
    log "Checksum created: ${out}.sha256"
  fi

  prune_old_backups "${BACKUP_DIR}" "${BACKUP_RETENTION_DAYS}"
  log "Backup created successfully: ${out} (${size_bytes} bytes)"
}

main "$@"
