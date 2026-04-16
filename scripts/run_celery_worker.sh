#!/usr/bin/env bash
set -euo pipefail

: "${DJANGO_SETTINGS_MODULE:=halkyemekproject.settings}"
: "${CELERY_LOG_LEVEL:=info}"
: "${CELERY_WORKER_NAME:?CELERY_WORKER_NAME is required}"
: "${CELERY_WORKER_QUEUES:?CELERY_WORKER_QUEUES is required}"
: "${CELERY_WORKER_PREFETCH_MULTIPLIER:=1}"
: "${CELERY_MAX_TASKS_PER_CHILD:=1000}"

export DJANGO_SETTINGS_MODULE

env_name="${APP_ENV:-${DJANGO_ENV:-dev}}"
env_name="${env_name,,}"
if [[ "${env_name}" == "production" || "${env_name}" == "live" ]]; then
  env_name="prod"
elif [[ "${env_name}" == "stage" ]]; then
  env_name="staging"
fi
if [[ "${env_name}" == "prod" || "${env_name}" == "staging" ]]; then
  python manage.py check --deploy
  python manage.py migrate --check
else
  python manage.py check
fi

args=(
  celery -A halkyemekproject worker
  -l "${CELERY_LOG_LEVEL}"
  -n "${CELERY_WORKER_NAME}@%h"
  -Q "${CELERY_WORKER_QUEUES}"
  "--prefetch-multiplier=${CELERY_WORKER_PREFETCH_MULTIPLIER}"
  "--max-tasks-per-child=${CELERY_MAX_TASKS_PER_CHILD}"
)

if [[ -n "${CELERY_CONCURRENCY:-}" ]]; then
  args+=("--concurrency=${CELERY_CONCURRENCY}")
fi

exec "${args[@]}"
