#!/usr/bin/env bash
set -euo pipefail

: "${DJANGO_SETTINGS_MODULE:=halkyemekproject.settings}"
: "${RUN_DB_MIGRATIONS:=1}"
: "${RUN_COLLECTSTATIC:=1}"
: "${RUN_FINAL_PREFLIGHT:=1}"
: "${RUN_VALIDATE_ENV_EXAMPLES:=1}"
: "${FINAL_PREFLIGHT_FAIL_ON_LOCK_SKIP:=1}"
: "${RUN_BOOTSTRAP_MARKETPLACE:=1}"
: "${RUN_VERIFY_BOOTSTRAP_MARKETPLACE:=1}"
: "${BOOTSTRAP_MARKETPLACE_DISTRICT:=BEYLIKDUZU}"
export DJANGO_SETTINGS_MODULE

if [[ "$#" -eq 0 ]]; then
  set -- true
fi

exec /app/scripts/prestart.sh "$@"
