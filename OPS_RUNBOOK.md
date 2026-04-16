# HalkYemek Operations Runbook

## Runtime topology
- `web`: Django + Gunicorn
- `worker-notifications`: Celery worker for `notifications,default`
- `worker-ops`: Celery worker for `ops,default`
- `worker-finance`: Celery worker for `finance,default`
- `worker-ops-heavy`: Celery worker for `ops_heavy,default`
- `beat`: Celery beat scheduler
- `db`: PostgreSQL
- `redis`: shared cache + Celery broker/backend

## Minimum production rules
- web / beat / en az iki worker lane ayrı process veya container olmalı
- shared Redis zorunlu
- SQLite prod'da yasak
- `.env` içinde `APP_ENV` veya `DJANGO_ENV` açıkça `staging` / `prod` olmalı
- `.env` içinde `APP_ENV`/`DJANGO_ENV` sadece `dev|staging|prod` olmalı (typo/unknown değer fail-fast)
- `.env.staging.example` ve `.env.prod.example` contract olarak baz alınmalı
- release fazı `scripts/release.sh` ile bir kez çalışmalı; web process staging/prod'da non-mutating `scripts/prestart.sh` ile açılmalı
- worker process `scripts/run_celery_worker.sh`, beat process `scripts/run_celery_beat.sh` ile açılmalı (staging/prod'da `check --deploy` + `migrate --check` zorunlu)
- tek scheduler lane: bir ortamda sadece 1 beat instance çalışmalı
- `/health/readiness/` deploy readiness için, `/health/readiness/?strict=1` go-live doğrulaması için kullanılmalı
- strict readiness içinde notification, checkout cleanup, payout batch create, payout dispatch, payout eligibility, payout sync, settlement reprocess, settlement import, integrity ve anomaly heartbeat'leri izlenmeli
- strict readiness içinde `celery_beat_scheduler` heartbeat'i de izlenmeli
- settlement inbox/archive/failed dizinleri ya birlikte boş olmalı ya da birlikte ve birbirinden farklı olarak tanımlanmalı
- `CELERY_VISIBILITY_TIMEOUT` finance/heavy runtime penceresinden kisa olmamali
- `SCHEDULER_HEARTBEAT_TTL_SECONDS > CELERY_BEAT_MAX_LOOP_INTERVAL` olmali
- beat job `expires` pencereleri cadence ile uyumlu kalmali (`BEAT_JOB_EXPIRES_SHORT_SECONDS`, `BEAT_JOB_EXPIRES_MEDIUM_SECONDS`, `BEAT_JOB_EXPIRES_LONG_SECONDS`)
- lock TTL env'leri (`*_LOCK_TTL_SECONDS`) scheduler araligindan kisa olmamali
- production metrics auth sadece `Authorization: Bearer <METRICS_TOKEN>` ile olmali (`METRICS_ALLOW_QUERY_TOKEN=False`)
- `TRUST_X_FORWARDED_FOR=True` ise `TRUSTED_PROXY_IPS` zorunlu; metrics/webhook IP allowlist kontrolleri sadece trusted proxy arkasinda calismali
- edge proxy/LB `X-Forwarded-For` ve `X-Real-IP` headerlarini strip edip yeniden set etmeli (client-provided forwarded header pass-through yasak)
- `SENTRY_DSN` prod ortaminda zorunlu olmali
- release cutover oncesi bir kez `python manage.py final_preflight_check --fail-on-lock-skip` calistirilmali

## Alerting baseline
- readiness 5 dakika boyunca 503
- strict readiness 2 kontrol üst üste 503
- `celery_beat_scheduler` heartbeat stale
- process_notifications heartbeat stale
- cleanup_checkout_sessions heartbeat stale
- dispatch_due_payouts heartbeat stale
- run_payout_eligibility heartbeat stale
- sync_sent_payout_statuses heartbeat stale
- reprocess_unmatched_settlement_records heartbeat stale
- import_pending_settlement_files heartbeat stale
- verify_financial_integrity heartbeat stale
- report_financial_anomalies heartbeat stale
- 5xx oranı artışı
- Celery queue backlog / worker-notifications offline / worker-ops offline / worker-finance offline / worker-ops-heavy offline / beat offline

## Deploy flow
1. release image build et
2. deploy öncesi logical backup al
3. staging ortamında aynı image ile `scripts/release.sh true` çalıştır
4. web / worker / beat proseslerini başlat
5. `scripts/smoke_test.sh (optionally with SMOKE_REQUIRED_PATHS for endpoint coverage)` ile health + readiness + strict readiness + metrics auth + release/env kontrolü yap
   - strict readiness warm-up icin gerekirse `STRICT_READINESS_RETRIES` / `STRICT_READINESS_INTERVAL_SECONDS` arttir
6. staging product smoke'u tamamla
7. production rollout yap
8. strict readiness ve background heartbeat'leri tekrar doğrula
9. warm-up: ilk strict check öncesi en az bir beat periyodu bekle veya kritik job'ları manuel bir kez tetikle

## Manual smoke after deploy
1. `GET /health/`
2. `GET /health/readiness/`
3. `GET /health/readiness/?strict=1`
4. Google login
5. wallet topup
6. checkout session create
7. cashier consume
8. payout eligibility / dispatch / sync
9. settlement import inbox sweep
10. metrics auth check
11. sentry test event (staging)

## Backup discipline
- deploy öncesi logical backup
- restore script staging'de aylık test (`RESTORE_CONFIRM=restore-$POSTGRES_DB scripts/restore_postgres.sh`)
- destructive migration varsa rollback SQL planı release ile birlikte tutulmalı
- aylık restore rehearsal raporu tutulmalı

## Fast runtime verification
- `scripts/check_celery_health.sh (optionally with explicit CELERY_WORKER_*_NODES for multi-host pools)` → validates `worker-notifications`, `worker-ops`, `worker-finance`, `worker-ops-heavy`, and beat heartbeat
- `BASE_URL=https://<env-host> EXPECTED_RELEASE=<release> scripts/release_acceptance.sh` → full prove-out after release or rollback

## Release handoff
- Tek akisin ozet referansi: `FINAL_RELEASE_HANDOFF.md`
- Release sonrasi zorunlu kanit: `scripts/release_acceptance.sh` + strict readiness + bootstrap dogrulamasi
