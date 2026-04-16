#!/usr/bin/env bash
set -euo pipefail

umask 077

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${POSTGRES_HOST:=localhost}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_SSLMODE:=prefer}"
: "${POSTGRES_CONNECT_TIMEOUT:=10}"
: "${BACKUP_DIR:=.}"

export PGPASSWORD="${POSTGRES_PASSWORD}"
export PGSSLMODE="${POSTGRES_SSLMODE}"
export PGCONNECT_TIMEOUT="${POSTGRES_CONNECT_TIMEOUT}"

mkdir -p "${BACKUP_DIR}"

STAMP="$(date +%Y%m%d_%H%M%S)"
out_arg="${1:-}"
if [[ -n "${out_arg}" ]]; then
  OUT="${out_arg}"
else
  OUT="${BACKUP_DIR%/}/backup_${POSTGRES_DB}_${STAMP}.sql.gz"
fi
TMP_OUT="${OUT}.tmp"

cleanup() {
  rm -f "${TMP_OUT}"
}

trap cleanup EXIT

pg_isready -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null

pg_dump \
  -h "${POSTGRES_HOST}" \
  -p "${POSTGRES_PORT}" \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  --format=plain \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  | gzip -9 > "${TMP_OUT}"

gzip -t "${TMP_OUT}"
mv "${TMP_OUT}" "${OUT}"

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${OUT}" > "${OUT}.sha256"
  echo "Checksum created: ${OUT}.sha256"
fi

echo "Backup created: ${OUT}"
