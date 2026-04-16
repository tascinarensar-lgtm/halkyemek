# HalkYemek Scheduled Jobs

## Primary production model
- Preferred runtime: **Celery beat + queue-separated Celery workers + Redis broker**
- Fallback runtime: system cron / Kubernetes CronJob calling the same management commands
- Single scheduler lane per environment. Multiple workers are safe; multiple beat instances are not.
- Redis broker visibility timeout must be >= longest finance/heavy task window.

## Queue map
- `notifications`: per-device notification delivery fanout
- `ops`: short operational sweeps and cleanup jobs
- `finance`: payout / settlement retry flows
- `ops_heavy`: integrity and anomaly scans
- `default`: explicit fallback only

## Command vs task ownership
- Celery task layer schedules/routes execution and wraps command invocation.
- Finance/ops/heavy business logic is executed in management commands.
- `process_notifications` command is enqueue-only; delivery is executed by `send_notification_attempt_task` on `notifications` queue.

## Worker map
- `worker-notifications`: `notifications,default`
- `worker-ops`: `ops,default`
- `worker-finance`: `finance,default`
- `worker-ops-heavy`: `ops_heavy,default`

## Every minute
- `process_notifications` on `ops`

## Every 5 minutes
- `dispatch_due_payouts --worker celery-beat --limit 50` on `finance`
- `sync_sent_payout_statuses --limit 50` on `finance`
- `cleanup_checkout_sessions --limit 500` on `ops`

## Every 15 minutes
- `create_payout_batch --max-businesses 100` on `finance`
- `reprocess_unmatched_settlement_records --limit 100` on `finance`
- `import_pending_settlement_files --limit 20` on `finance`

## Hourly
- `run_payout_eligibility` on `finance`
- `verify_financial_integrity` on `ops_heavy`
- `report_financial_anomalies` on `ops_heavy`

## Daily
- settlement files are ingested continuously from `SETTLEMENT_IMPORT_INBOX_DIR` by `import_pending_settlement_files`
- `scripts/backup_postgres.sh`

## Operational notes
- Locking is enforced with cache-based job leases. Each invocation now uses a unique lock token, so an expired older lease cannot accidentally delete a newer lease owned by another worker.
- Job leases auto-refresh while the command is still running; worker death still lets the lease expire naturally.
- Beat jobs use `expires` to prevent stale backlog replay after outages; keep expiry windows aligned with schedule cadence.
- Readiness should be evaluated together with heartbeats and Celery process health.
- Trusted proxy policy should be enforced (`TRUST_X_FORWARDED_FOR=True` only with `TRUSTED_PROXY_IPS`).
- After deploy/restart, strict readiness can stay red until first beat cycle updates all required heartbeats.
- `import_iyzico_settlement` can still be run manually for ad-hoc files; routine ingestion is handled by `import_pending_settlement_files`.
- automatic settlement import orchestration uses inbox/archive/failed directories and a dedicated heartbeat (`import_pending_settlement_files`).

## Post-deploy verification
- After worker or beat restarts, run `scripts/check_celery_health.sh (optionally with explicit CELERY_WORKER_*_NODES for multi-host pools)` to confirm all dedicated lanes are reachable and the scheduler heartbeat is refreshing
