#!/usr/bin/env bash
set -euo pipefail

: "${DJANGO_SETTINGS_MODULE:=halkyemekproject.settings}"
: "${CELERY_LOG_LEVEL:=info}"
: "${CELERY_BEAT_SCHEDULE_FILE:=/tmp/celerybeat-schedule}"
: "${CELERY_BEAT_MAX_LOOP_INTERVAL:=60}"

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

mkdir -p "$(dirname "${CELERY_BEAT_SCHEDULE_FILE}")"

exec celery -A halkyemekproject beat -l "${CELERY_LOG_LEVEL}" --pidfile= --schedule "${CELERY_BEAT_SCHEDULE_FILE}" --max-interval "${CELERY_BEAT_MAX_LOOP_INTERVAL}"
