#!/usr/bin/env bash
set -euo pipefail

: "${BASE_URL:?BASE_URL is required}"
: "${EXPECTED_APP_ENV:?EXPECTED_APP_ENV is required}"
: "${EXPECTED_RELEASE:?EXPECTED_RELEASE is required}"
: "${RUN_FINAL_PREFLIGHT_COMMAND:=1}"
: "${RUN_CELERY_HEALTH_CHECK:=1}"
: "${RUN_FINANCE_COMMANDS:=1}"
: "${SMOKE_TEST_SCRIPT:=./scripts/smoke_test.sh}"
: "${STAGING_PROVE_OUT_SCRIPT:=./scripts/staging_prove_out.sh}"

normalize_bool() {
  local raw="${1:-0}"
  raw="${raw,,}"
  case "${raw}" in
    1|true|yes|on) echo "1" ;;
    *) echo "0" ;;
  esac
}

if [[ "$(normalize_bool "${RUN_FINAL_PREFLIGHT_COMMAND}")" == "1" ]]; then
  python manage.py final_preflight_check --fail-on-lock-skip
fi

if [[ "$(normalize_bool "${RUN_FINANCE_COMMANDS}")" == "1" ]]; then
  python manage.py verify_financial_integrity
  python manage.py report_financial_anomalies
fi

if [[ "$(normalize_bool "${RUN_CELERY_HEALTH_CHECK}")" == "1" ]]; then
  ./scripts/check_celery_health.sh
fi

EXPECTED_APP_ENV="${EXPECTED_APP_ENV}" EXPECTED_RELEASE="${EXPECTED_RELEASE}" BASE_URL="${BASE_URL}" "${SMOKE_TEST_SCRIPT}"

echo "Release acceptance passed for ${BASE_URL} (${EXPECTED_APP_ENV} / ${EXPECTED_RELEASE})"
