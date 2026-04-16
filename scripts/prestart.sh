#!/usr/bin/env bash
set -euo pipefail

: "${DJANGO_SETTINGS_MODULE:=halkyemekproject.settings}"
: "${RUN_DB_MIGRATIONS:=0}"
: "${RUN_COLLECTSTATIC:=0}"
: "${RUN_FINAL_PREFLIGHT:=0}"
: "${RUN_VALIDATE_ENV_EXAMPLES:=0}"
: "${RUN_BOOTSTRAP_MARKETPLACE:=0}"
: "${RUN_VERIFY_BOOTSTRAP_MARKETPLACE:=0}"
: "${BOOTSTRAP_MARKETPLACE_DISTRICT:=BEYLIKDUZU}"
: "${FINAL_PREFLIGHT_FAIL_ON_LOCK_SKIP:=0}"
export DJANGO_SETTINGS_MODULE

normalize_bool() {
  local raw="${1:-0}"
  raw="${raw,,}"
  case "${raw}" in
    1|true|yes|on) echo "1" ;;
    *) echo "0" ;;
  esac
}

run_db_migrations="$(normalize_bool "${RUN_DB_MIGRATIONS}")"
run_collectstatic="$(normalize_bool "${RUN_COLLECTSTATIC}")"
run_final_preflight="$(normalize_bool "${RUN_FINAL_PREFLIGHT}")"
run_validate_env_examples="$(normalize_bool "${RUN_VALIDATE_ENV_EXAMPLES}")"
run_bootstrap_marketplace="$(normalize_bool "${RUN_BOOTSTRAP_MARKETPLACE}")"
run_verify_bootstrap_marketplace="$(normalize_bool "${RUN_VERIFY_BOOTSTRAP_MARKETPLACE}")"
final_preflight_fail_on_lock_skip="$(normalize_bool "${FINAL_PREFLIGHT_FAIL_ON_LOCK_SKIP}")"

env_name="${APP_ENV:-${DJANGO_ENV:-dev}}"
env_name="${env_name,,}"
if [[ "${env_name}" == "production" || "${env_name}" == "live" ]]; then
  env_name="prod"
elif [[ "${env_name}" == "stage" ]]; then
  env_name="staging"
fi

if [[ "${env_name}" == "prod" || "${env_name}" == "staging" ]]; then
  python manage.py check --deploy
else
  python manage.py check
fi

if [[ "${run_db_migrations}" == "1" ]]; then
  python manage.py migrate --noinput
else
  python manage.py migrate --check
fi

if [[ "${run_collectstatic}" == "1" ]]; then
  python manage.py collectstatic --noinput
fi

if [[ "${run_bootstrap_marketplace}" == "1" ]]; then
  python manage.py bootstrap_marketplace --district "${BOOTSTRAP_MARKETPLACE_DISTRICT}"
fi

if [[ "${run_verify_bootstrap_marketplace}" == "1" ]]; then
  python manage.py verify_bootstrap_marketplace --district "${BOOTSTRAP_MARKETPLACE_DISTRICT}"
fi

if [[ "${run_validate_env_examples}" == "1" ]]; then
  python manage.py validate_env_examples
fi

if [[ "${run_final_preflight}" == "1" ]]; then
  preflight_args=()
  if [[ "${final_preflight_fail_on_lock_skip}" == "1" ]]; then
    preflight_args+=(--fail-on-lock-skip)
  fi
  python manage.py final_preflight_check "${preflight_args[@]}"
fi

exec "$@"
