# Production Operations Baseline

## Runtime process model
- `release`: one-off migration/collectstatic/preflight phase
- `web`: Django/Gunicorn API only
- `worker-notifications`: `notifications,default` queues
- `worker-ops`: `ops,default` queues
- `worker-finance`: `finance,default` queues
- `worker-ops-heavy`: `ops_heavy,default` queues
- `beat`: exactly one instance per environment

## Required environment guarantees
- `APP_ENV` in `{staging,prod}` and `DEBUG=0`
- `RELEASE_VERSION` immutable and non-dev
- `DATABASE_URL` points to PostgreSQL
- `REDIS_CACHE_URL` points to shared Redis
- `SENTRY_DSN` configured in prod
- `METRICS_TOKEN` and/or `METRICS_IP_ALLOWLIST` configured
- `METRICS_ALLOW_QUERY_TOKEN=False` in prod
- `TRUST_X_FORWARDED_FOR=True` only with explicit `TRUSTED_PROXY_IPS`
- edge proxy/LB must strip and overwrite inbound `X-Forwarded-For` and `X-Real-IP`
- settlement import dirs configured together and distinct (`INBOX/ARCHIVE/FAILED`)

## Health/readiness contract
- `/health/` for liveness
- `/health/readiness/` for core dependency readiness
- `/health/readiness/?strict=1` for go-live (core + job heartbeat freshness)
- `/health/metrics/` only with allowlisted IP or bearer token

## Operational command baseline
- `scripts/release.sh true`
- `python manage.py final_preflight_check`
- `python manage.py final_preflight_check --fail-on-lock-skip` before production cutover
- `python manage.py verify_financial_integrity`
- `python manage.py report_financial_anomalies`
- `scripts/smoke_test.sh (optionally with SMOKE_REQUIRED_PATHS for endpoint coverage)`

## Backup and restore baseline
- Backup before every deploy: `scripts/backup_postgres.sh`
- Optional `BACKUP_DIR` target supported for artifact retention
- Keep generated `.sha256` integrity files with backup artifacts
- Restore rehearsal at least monthly on staging: `scripts/restore_postgres.sh`

## Alerting baseline
- readiness returns `503` for 5+ minutes
- strict readiness returns `503` in two consecutive checks
- `celery_beat_scheduler` heartbeat stale
- any critical job heartbeat stale
- `import_pending_settlement_files` heartbeat stale
- sustained API 5xx increase
- queue lag growth in `notifications`, `ops`, `finance`, `ops_heavy`

## Staging prove-out baseline
- `scripts/check_celery_health.sh (optionally with explicit CELERY_WORKER_*_NODES for multi-host pools)` validates all four worker lanes and the beat heartbeat from the live environment
- `scripts/staging_prove_out.sh` runs final preflight, finance integrity commands, Celery health validation, and HTTP smoke test in one repeatable flow
- Use `BASE_URL=https://staging-api.example.com EXPECTED_RELEASE=<tag> scripts/staging_prove_out.sh` before every production cutover

## Bootstrap baseline
- Release phase varsayimi: config validation + migrate + bootstrap_marketplace + validate_env_examples + final_preflight_check
- Discovery minimum resmi veritabani baseline'i marketplace category bootstrap seedidir.
