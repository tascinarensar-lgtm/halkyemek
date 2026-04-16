#!/usr/bin/env bash
set -euo pipefail

: "${DJANGO_SETTINGS_MODULE:=halkyemekproject.settings}"
: "${CELERY_APP:=halkyemekproject}"
: "${CELERY_PING_TIMEOUT:=5}"
: "${REQUIRE_BEAT_HEARTBEAT:=1}"
export DJANGO_SETTINGS_MODULE

normalize_bool() {
  local raw="${1:-0}"
  raw="${raw,,}"
  case "${raw}" in
    1|true|yes|on) echo "1" ;;
    *) echo "0" ;;
  esac
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

split_csv() {
  local raw="$1"
  local -n out_ref="$2"
  out_ref=()
  IFS=',' read -r -a out_ref <<<"${raw}"
  local cleaned=()
  local item
  for item in "${out_ref[@]}"; do
    item="${item## }"
    item="${item%% }"
    [[ -n "${item}" ]] && cleaned+=("${item}")
  done
  out_ref=("${cleaned[@]}")
}

check_workers() {
  local lane="$1"
  local nodes_csv="$2"
  local nodes=()
  split_csv "${nodes_csv}" nodes
  if [[ ${#nodes[@]} -eq 0 ]]; then
    echo "No worker nodes configured for lane ${lane}" >&2
    return 1
  fi

  local node output
  for node in "${nodes[@]}"; do
    if ! output="$(celery -A "${CELERY_APP}" inspect ping -d "${node}" --timeout="${CELERY_PING_TIMEOUT}" 2>&1)"; then
      echo "Worker ping failed for ${lane} (${node}): ${output}" >&2
      return 1
    fi
    grep -q 'OK' <<<"${output}" || {
      echo "Worker ${lane} (${node}) did not return OK: ${output}" >&2
      return 1
    }
    echo "Worker healthy: ${lane} (${node})"
  done
}

require_command celery
require_command python

host="${HOSTNAME:-$(hostname)}"
: "${CELERY_WORKER_NOTIFICATION_NODES:=worker-notifications@${host}}"
: "${CELERY_WORKER_OPS_NODES:=worker-ops@${host}}"
: "${CELERY_WORKER_FINANCE_NODES:=worker-finance@${host}}"
: "${CELERY_WORKER_OPS_HEAVY_NODES:=worker-ops-heavy@${host}}"

check_workers notifications "${CELERY_WORKER_NOTIFICATION_NODES}"
check_workers ops "${CELERY_WORKER_OPS_NODES}"
check_workers finance "${CELERY_WORKER_FINANCE_NODES}"
check_workers ops-heavy "${CELERY_WORKER_OPS_HEAVY_NODES}"

if [[ "$(normalize_bool "${REQUIRE_BEAT_HEARTBEAT}")" == "1" ]]; then
  python manage.py shell -c "from django.conf import settings; from health.services import heartbeat_ok, SCHEDULER_HEARTBEAT_NAME; import sys; sys.exit(0 if heartbeat_ok(SCHEDULER_HEARTBEAT_NAME, settings.SCHEDULER_HEARTBEAT_TTL_SECONDS) else 1)"
  echo "Beat heartbeat healthy"
fi

echo "Celery health checks passed"
