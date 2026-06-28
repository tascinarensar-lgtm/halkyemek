#!/usr/bin/env bash
set -euo pipefail

timestamp() {
  date +"%Y-%m-%dT%H:%M:%S%z"
}

log() {
  echo "[$(timestamp)] [restore_postgres] $*"
}

usage() {
  cat <<'EOF'
Usage:
  restore_postgres.sh <backup.sql.gz|backup.sql> --yes

Safety:
  - Restore file is required.
  - --yes is mandatory.
  - In production, RESTORE_CONFIRM must equal restore-<database_name>.
EOF
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
  export PGSSLMODE="${PGSSLMODE:-${POSTGRES_SSLMODE}}"
  export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-${POSTGRES_CONNECT_TIMEOUT}}"

  case "${CONNECTION_MODE}" in
    uri)
      DB_LABEL="${RESTORE_DB_LABEL:-database}"
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

run_psql() {
  case "${CONNECTION_MODE}" in
    uri)
      psql --dbname="${DATABASE_URL}" "$@"
      ;;
    *)
      psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" "$@"
      ;;
  esac
}

assert_restore_allowed() {
  local app_env expected
  app_env="${APP_ENV:-${DJANGO_ENV:-${ENVIRONMENT:-}}}"
  app_env="${app_env,,}"

  if [[ "${app_env}" == "prod" || "${app_env}" == "production" || "${app_env}" == "live" ]]; then
    expected="restore-${DB_LABEL}"
    if [[ "${RESTORE_CONFIRM:-}" != "${expected}" ]]; then
      echo "Production restore guard failed. Set RESTORE_CONFIRM=${expected}" >&2
      exit 1
    fi
  fi
}

main() {
  local file="" confirm="0"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --yes)
        confirm="1"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      -*)
        echo "Unknown option: $1" >&2
        usage >&2
        exit 1
        ;;
      *)
        if [[ -n "${file}" ]]; then
          echo "Only one backup file can be provided." >&2
          usage >&2
          exit 1
        fi
        file="$1"
        shift
        ;;
    esac
  done

  if [[ -z "${file}" ]]; then
    usage >&2
    exit 1
  fi

  if [[ "${confirm}" != "1" ]]; then
    echo "--yes is required to run restore." >&2
    exit 1
  fi

  if [[ ! -f "${file}" ]]; then
    echo "Backup file not found: ${file}" >&2
    exit 1
  fi

  resolve_connection_mode
  configure_connection_env
  assert_restore_allowed

  log "Testing database connectivity before restore target=${DB_LABEL}"
  pg_ready
  run_psql -tAc "SELECT 1;" >/dev/null

  case "${file}" in
    *.gz)
      gzip -t "${file}"
      if [[ -f "${file}.sha256" ]] && command -v sha256sum >/dev/null 2>&1; then
        sha256sum -c "${file}.sha256"
      fi
      log "Starting gzip restore from ${file}"
      gunzip -c "${file}" | run_psql -1 -v ON_ERROR_STOP=1
      ;;
    *.sql)
      log "Starting plain SQL restore from ${file}"
      run_psql -1 -v ON_ERROR_STOP=1 -f "${file}"
      ;;
    *)
      echo "Unsupported backup format: ${file}. Use .sql or .sql.gz" >&2
      exit 1
      ;;
  esac

  log "Restore completed successfully from ${file}"
}

main "$@"
