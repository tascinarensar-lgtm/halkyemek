#!/usr/bin/env bash
set -euo pipefail

: "${BASE_URL:?BASE_URL is required}"
: "${EXPECTED_APP_ENV:=staging}"
: "${SMOKE_TEST_SCRIPT:=/app/scripts/smoke_test.sh}"
: "${RUN_FINAL_PREFLIGHT_COMMAND:=1}"
: "${RUN_FINANCE_COMMANDS:=1}"
: "${RUN_CELERY_HEALTH_CHECK:=1}"
: "${FINAL_PREFLIGHT_FAIL_ON_LOCK_SKIP:=1}"
export FINAL_PREFLIGHT_FAIL_ON_LOCK_SKIP

normalize_bool() {
  local raw="${1:-0}"
  raw="${raw,,}"
  case "${raw}" in
    1|true|yes|on) echo "1" ;;
    *) echo "0" ;;
  esac
}

step() {
  echo
  echo "==> $1"
}

if [[ "$(normalize_bool "${RUN_FINAL_PREFLIGHT_COMMAND}")" == "1" ]]; then
  step "Running final preflight"
  python manage.py final_preflight_check --fail-on-lock-skip
fi

if [[ "$(normalize_bool "${RUN_FINANCE_COMMANDS}")" == "1" ]]; then
  step "Running finance integrity commands"
  python manage.py verify_financial_integrity
  python manage.py report_financial_anomalies
fi

if [[ "$(normalize_bool "${RUN_CELERY_HEALTH_CHECK}")" == "1" ]]; then
  step "Checking Celery worker and beat health"
  ./scripts/check_celery_health.sh
fi

step "Running HTTP smoke test"
EXPECTED_APP_ENV="${EXPECTED_APP_ENV}" "${SMOKE_TEST_SCRIPT}"

echo
echo "Staging prove-out completed successfully"
