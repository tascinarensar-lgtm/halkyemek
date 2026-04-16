# HalkYemek Go-Live Checklist

## Security
- [ ] DEBUG=False
- [ ] SECRET_KEY is strong and loaded from env
- [ ] ALLOWED_HOSTS configured
- [ ] CSRF_TRUSTED_ORIGINS configured
- [ ] HTTPS enabled
- [ ] HSTS enabled
- [ ] Shared cache configured
- [ ] Google OAuth configured
- [ ] FCM configured
- [ ] iyzico configured
- [ ] Webhook secret configured
- [ ] Metrics endpoint protected
- [ ] Metrics query-token auth disabled in prod (`METRICS_ALLOW_QUERY_TOKEN=False`)
- [ ] `TRUST_X_FORWARDED_FOR=True` ise `TRUSTED_PROXY_IPS` configured
- [ ] edge proxy `X-Forwarded-For` / `X-Real-IP` strip+overwrite policy verified
- [ ] Sentry / external error tracking configured
- [ ] Immutable `RELEASE_VERSION` configured
- [ ] Body size limit active
- [ ] Throttles active on critical endpoints

## Financial
- [ ] `verify_financial_integrity` passed
- [ ] `report_financial_anomalies` passed
- [ ] Settlement import tested
- [ ] Settlement inbox/failed/archive directories tested
- [ ] Payout sent/confirmed tested
- [ ] Duplicate payout/provider_reference blocked
- [ ] Replay guard verified

## Operations
- [ ] backup script tested
- [ ] restore script tested
- [ ] rollback plan reviewed
- [ ] readiness endpoint returns 200
- [ ] strict readiness returns 200
- [ ] metrics endpoint reachable with token/IP allowlist
- [ ] metrics query token path returns 403 in prod
- [ ] scheduler active
- [ ] beat active
- [ ] exactly one beat instance active
- [ ] worker startup uses deploy checks (`check --deploy` + `migrate --check`) and web startup is non-mutating
- [ ] `celery_beat_scheduler` heartbeat is fresh
- [ ] job heartbeats are fresh
- [ ] `import_pending_settlement_files` heartbeat is fresh
- [ ] notification backlog is draining on `worker-notifications`
- [ ] structured logs collected centrally

## Product Flow
- [ ] Google login tested
- [ ] district catalog tested
- [ ] wallet topup tested
- [ ] checkout session tested
- [ ] cashier consume tested
- [ ] payout flow tested
- [ ] admin broadcast tested

## Final
- [ ] `python manage.py final_preflight_check`
- [ ] `python manage.py final_preflight_check --fail-on-lock-skip`
- [ ] `scripts/smoke_test.sh (optionally with SMOKE_REQUIRED_PATHS for endpoint coverage)` with `EXPECTED_APP_ENV` and `EXPECTED_RELEASE`
- [ ] `scripts/backup_postgres.sh` produced verified artifact before release
- [ ] full test suite passed
- [ ] release tag created
- [ ] production image built
- [ ] rollback image ready

## Notes
- `/health/readiness/` core dependency readiness içindir.
- `/health/readiness/?strict=1` ops heartbeat freshness dahil stricter go-live kontrolüdür.

## Final prove-out gate
- [ ] `python manage.py final_preflight_check --fail-on-lock-skip` passes
- [ ] `scripts/check_celery_health.sh (optionally with explicit CELERY_WORKER_*_NODES for multi-host pools)` passes against the live worker/beat pool
- [ ] `BASE_URL=https://<staging-host> EXPECTED_RELEASE=<release> scripts/release_acceptance.sh` passed on the exact release candidate build
- [ ] cart snapshot -> checkout snapshot -> order snapshot zinciri random sample orderlarda dogrulandi
- [ ] fixed customer fee / fixed business fee sample orderlarda muhasebe snapshot ile birebir eslesti
- [ ] en az bir refund ve bir chargeback senaryosu payout adjustment etkisiyle rehearse edildi

## Bootstrap acceptance
- [ ] Official marketplace bootstrap calistirildi
- [ ] Discovery category seedleri olustu
- [ ] `Diğer` kategorisi aktif
- [ ] Frontend home discovery kategorileri bos donmuyor
