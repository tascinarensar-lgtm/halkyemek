#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${POSTGRES_HOST:=localhost}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_SSLMODE:=prefer}"
: "${POSTGRES_CONNECT_TIMEOUT:=10}"

FILE="${1:?Usage: restore_postgres.sh <backup.sql.gz>}"
: "${RESTORE_CONFIRM:?Set RESTORE_CONFIRM=restore-${POSTGRES_DB} to allow restore}"

if [[ "${RESTORE_CONFIRM}" != "restore-${POSTGRES_DB}" ]]; then
  echo "RESTORE_CONFIRM must equal restore-${POSTGRES_DB}" >&2
  exit 1
fi

if [[ ! -f "${FILE}" ]]; then
  echo "Backup file not found: ${FILE}" >&2
  exit 1
fi

export PGPASSWORD="${POSTGRES_PASSWORD}"
export PGSSLMODE="${POSTGRES_SSLMODE}"
export PGCONNECT_TIMEOUT="${POSTGRES_CONNECT_TIMEOUT}"

gzip -t "${FILE}"
pg_isready -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null

if [[ -f "${FILE}.sha256" ]] && command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c "${FILE}.sha256"
fi

gunzip -c "${FILE}" | psql \
  -1 \
  -v ON_ERROR_STOP=1 \
  -h "${POSTGRES_HOST}" \
  -p "${POSTGRES_PORT}" \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}"

echo "Restore completed from: ${FILE}"
