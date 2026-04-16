# HalkYemek Deployment Checklist

> Not: `.env.example` local/development bootstrap içindir; rollout için `.env.staging.example` veya `.env.prod.example` baz alınmalıdır.

## Pre-deploy
- [ ] Tests passed
- [ ] `python manage.py check --deploy` passed
- [ ] `python manage.py migrate --plan` reviewed
- [ ] `.env` production values verified
- [ ] `.env.prod.example` contracti baz alinmis
- [ ] `python manage.py validate_env_examples` passed
- [ ] `APP_ENV` or `DJANGO_ENV` is `prod`
- [ ] `DATABASE_URL` points to Postgres
- [ ] `REDIS_CACHE_URL` configured
- [ ] `CELERY_VISIBILITY_TIMEOUT` validated for finance/heavy jobs
- [ ] `SETTLEMENT_REPROCESS_MAX_ATTEMPTS`, `SETTLEMENT_REPROCESS_BASE_SECONDS`, `SETTLEMENT_REPROCESS_MAX_SECONDS` validated
- [ ] `SETTLEMENT_IMPORT_INBOX_DIR`, `SETTLEMENT_IMPORT_ARCHIVE_DIR`, `SETTLEMENT_IMPORT_FAILED_DIR` validated
- [ ] settlement import dizinleri var, dizin tipinde ve uygulama kullanicisi tarafindan yazilabilir
- [ ] `NOTIFICATION_ENQUEUE_DEDUP_TTL_SECONDS` validated
- [ ] `METRICS_TOKEN` and/or `METRICS_IP_ALLOWLIST` configured
- [ ] `METRICS_ALLOW_QUERY_TOKEN=False` in production
- [ ] `TRUST_X_FORWARDED_FOR=True` ise `TRUSTED_PROXY_IPS` configured
- [ ] edge proxy `X-Forwarded-For` / `X-Real-IP` headerlarini strip+overwrite ediyor
- [ ] `PAYMENT_WEBHOOK_SECRET` configured
- [ ] Google OAuth configured
- [ ] FCM credentials configured
- [ ] iyzico credentials configured
- [ ] Sentry / external error tracking configured
- [ ] Database backup taken
- [ ] Rollback image/tag ready
- [ ] `scripts/release.sh true` succeeds on staging
- [ ] release phase `RUN_VALIDATE_ENV_EXAMPLES=1` ile calisiyor
- [ ] `python manage.py final_preflight_check --fail-on-lock-skip` passed once before production cutover
- [ ] `scripts/run_celery_worker.sh` and `scripts/run_celery_beat.sh` are used by runtime
- [ ] `CELERY_MAX_TASKS_PER_CHILD` tuned (default 1000) for long-running worker stability

## Deploy
- [ ] New image built
- [ ] New image pushed
- [ ] One-off release phase completed (`scripts/release.sh true`)
- [ ] Migrations applied exactly once
- [ ] `python manage.py collectstatic --noinput` completed exactly once
- [ ] App restarted without re-running migrations
- [ ] Scheduler/worker restarted
- [ ] `worker-notifications`, `worker-ops`, `worker-finance`, `worker-ops-heavy`, and `beat` are all healthy
- [ ] exactly one beat instance is running
- [ ] `celery_beat_scheduler` heartbeat is fresh
- [ ] `/health/` returns 200
- [ ] `/health/readiness/` returns 200
- [ ] `/health/readiness/?strict=1` returns 200
- [ ] strict readiness checked after at least one beat cycle warm-up
- [ ] strict readiness warm-up retries tuned (`STRICT_READINESS_RETRIES`, `STRICT_READINESS_INTERVAL_SECONDS`)
- [ ] `/health/metrics/` reachable with auth
- [ ] `/health/metrics/?token=...` disabled in production (expect 403)

## Post-deploy
- [ ] `scripts/smoke_test.sh (optionally with SMOKE_REQUIRED_PATHS for endpoint coverage)` completed with `EXPECTED_APP_ENV` / `EXPECTED_RELEASE`
- [ ] Google login tested
- [ ] Device register tested
- [ ] Checkout session create tested
- [ ] Consume / order creation tested
- [ ] Payment flow tested
- [ ] QR flow tested
- [ ] Settlement import dry run tested
- [ ] `import_pending_settlement_files --limit 1` tested
- [ ] Payout flow tested
- [ ] `verify_financial_integrity` passed
- [ ] `report_financial_anomalies` passed
- [ ] Background job heartbeats updated
- [ ] backup checksum artifact retained when backup is created

## Notes
- `/health/readiness/` core dependency readiness içindir.
- `/health/readiness/?strict=1` ops heartbeat freshness dahil stricter go-live kontrolüdür.

## Release verification additions
- [ ] Run `scripts/check_celery_health.sh (optionally with explicit CELERY_WORKER_*_NODES for multi-host pools)` inside the deployed environment after workers/beat are up
- [ ] Run `BASE_URL=https://<env-host> EXPECTED_RELEASE=<release> scripts/release_acceptance.sh` on staging before production cutover
- [ ] sample cart-backed orderlarda `pricing_snapshot`, `order_snapshot` ve `BusinessEarning` alanlari release oncesi spot-check edildi

## Bootstrap / discovery
- [ ] `RUN_BOOTSTRAP_MARKETPLACE=1` ve `BOOTSTRAP_MARKETPLACE_DISTRICT=BEYLIKDUZU` release ortaminda dogru mu?
- [ ] `python manage.py bootstrap_marketplace --district BEYLIKDUZU` komutu staging/prod verisinde hatasiz calisiyor mu?
- [ ] `/api/v1/discovery/home/?district=BEYLIKDUZU` icinde `categories` blogu bos degil mi?
