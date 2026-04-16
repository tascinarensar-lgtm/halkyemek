#!/usr/bin/env bash
set -euo pipefail

: "${BASE_URL:?BASE_URL is required}"
: "${EXPECTED_APP_ENV:=}"
: "${EXPECTED_RELEASE:=}"
: "${STRICT_READINESS_RETRIES:=24}"
: "${STRICT_READINESS_INTERVAL_SECONDS:=10}"
: "${CURL_MAX_TIME_SECONDS:=10}"
: "${SMOKE_REQUIRED_PATHS:=}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_command curl
require_command python

wait_for_strict_readiness() {
  local attempt=1
  while [[ "${attempt}" -le "${STRICT_READINESS_RETRIES}" ]]; do
    local status
    status="$(curl -sS --max-time "${CURL_MAX_TIME_SECONDS}" -o /dev/null -w "%{http_code}" "${BASE_URL}/health/readiness/?strict=1")"
    if [[ "${status}" == "200" ]]; then
      echo "strict readiness passed on attempt ${attempt}/${STRICT_READINESS_RETRIES}"
      return 0
    fi
    echo "strict readiness not ready yet (attempt ${attempt}/${STRICT_READINESS_RETRIES}, status=${status})"
    sleep "${STRICT_READINESS_INTERVAL_SECONDS}"
    attempt=$((attempt + 1))
  done
  echo "strict readiness failed after ${STRICT_READINESS_RETRIES} attempts" >&2
  return 1
}

AUTH_HEADER=()
if [[ -n "${METRICS_TOKEN:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${METRICS_TOKEN}")
fi

: "${METRICS_ALLOW_QUERY_TOKEN:=false}"
: "${METRICS_EXPECT_PUBLIC_OK:=false}"

tmp_headers="$(mktemp)"
trap 'rm -f "${tmp_headers}"' EXIT

health_payload="$(curl -fsS --max-time "${CURL_MAX_TIME_SECONDS}" -D "${tmp_headers}" "${BASE_URL}/health/")"
python - <<'PY' "${health_payload}" "${EXPECTED_APP_ENV}" "${EXPECTED_RELEASE}"
import json, sys
payload = json.loads(sys.argv[1])
expected_env = sys.argv[2].strip()
expected_release = sys.argv[3].strip()
if not payload.get('ok'):
    raise SystemExit('health endpoint did not report ok=true')
if expected_env and payload.get('env') != expected_env:
    raise SystemExit(f"unexpected env: {payload.get('env')} != {expected_env}")
if expected_release and payload.get('release') != expected_release:
    raise SystemExit(f"unexpected release: {payload.get('release')} != {expected_release}")
PY
grep -qi '^X-Request-ID:' "${tmp_headers}"

readiness_payload="$(curl -fsS --max-time "${CURL_MAX_TIME_SECONDS}" "${BASE_URL}/health/readiness/")"
python - <<'PY' "${readiness_payload}"
import json, sys
payload = json.loads(sys.argv[1])
if not payload.get('core_ok'):
    raise SystemExit(f"core readiness failed: {payload.get('failing_checks')}")
PY

wait_for_strict_readiness
strict_readiness_payload="$(curl -fsS --max-time "${CURL_MAX_TIME_SECONDS}" "${BASE_URL}/health/readiness/?strict=1")"
python - <<'PY' "${strict_readiness_payload}"
import json, sys
payload = json.loads(sys.argv[1])
if not payload.get('ok'):
    raise SystemExit(f"strict readiness failed: {payload.get('failing_checks')}")
PY

public_metrics_status="$(curl -sS --max-time "${CURL_MAX_TIME_SECONDS}" -o /dev/null -w "%{http_code}" "${BASE_URL}/health/metrics/")"
if [[ ${#AUTH_HEADER[@]} -gt 0 ]]; then
  [[ "${public_metrics_status}" == "403" ]]
  query_metrics_status="$(curl -sS --max-time "${CURL_MAX_TIME_SECONDS}" -o /dev/null -w "%{http_code}" "${BASE_URL}/health/metrics/?token=${METRICS_TOKEN}")"
  if [[ "${METRICS_ALLOW_QUERY_TOKEN,,}" == "true" ]]; then
    [[ "${query_metrics_status}" == "200" ]]
  else
    [[ "${query_metrics_status}" == "403" ]]
  fi
  auth_metrics_body="$(curl -fsS --max-time "${CURL_MAX_TIME_SECONDS}" "${AUTH_HEADER[@]}" "${BASE_URL}/health/metrics/")"
  grep -q 'halkyemek_release_info' <<<"${auth_metrics_body}"
  grep -q 'halkyemek_job_heartbeat_recent' <<<"${auth_metrics_body}"
else
  if [[ "${METRICS_EXPECT_PUBLIC_OK,,}" == "true" ]]; then
    [[ "${public_metrics_status}" == "200" ]]
    public_metrics_body="$(curl -fsS --max-time "${CURL_MAX_TIME_SECONDS}" "${BASE_URL}/health/metrics/")"
    grep -q 'halkyemek_release_info' <<<"${public_metrics_body}"
  else
    [[ "${public_metrics_status}" != "200" ]]
  fi
fi

if [[ -n "${SMOKE_REQUIRED_PATHS}" ]]; then
  IFS=',' read -r -a required_paths <<<"${SMOKE_REQUIRED_PATHS}"
  for raw_path in "${required_paths[@]}"; do
    path="${raw_path## }"
    path="${path%% }"
    [[ -z "${path}" ]] && continue
    status="$(curl -sS --max-time "${CURL_MAX_TIME_SECONDS}" -o /dev/null -w "%{http_code}" "${BASE_URL}${path}")"
    [[ "${status}" != "404" ]]
  done
fi

echo "Smoke test passed for ${BASE_URL}"
