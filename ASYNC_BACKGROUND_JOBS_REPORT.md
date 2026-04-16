# Async / Background Jobs Review and Refactor Report

## Current state found in the repo

### Already background-like but still operator/manual driven
- `notifications/management/commands/process_notifications.py`
- `payouts/management/commands/run_payout_eligibility.py`
- `payouts/management/commands/dispatch_due_payouts.py`
- `payouts/management/commands/sync_sent_payout_statuses.py`
- `payouts/management/commands/verify_financial_integrity.py`
- `payments/management/commands/report_financial_anomalies.py`
- `payments/management/commands/import_iyzico_settlement.py`
- `common/management/commands/final_preflight_check.py`

### Async-worthy flows detected in code
1. **Notification delivery**
   - enqueue is request-time
   - actual send/retry is deferred
   - needed stronger worker handoff and scheduler discipline
2. **Payout eligibility sweep**
   - time-based transition from `PENDING -> ELIGIBLE`
3. **Payout dispatch**
   - already has retry/backoff/lock semantics in DB state
   - still needs production scheduler/worker topology
4. **Payout status sync**
   - `SENT -> CONFIRMED/FAILED` reconciliation with provider must be periodic
5. **Settlement reprocessing**
   - import may arrive before local entity, or stay manual review temporarily
   - unresolved records should be retried periodically
6. **Integrity scan**
   - expensive operational scan, not request-time
7. **Anomaly scan**
   - operational reporting only, not request-time
8. **Checkout session cleanup**
   - stale `PENDING` sessions were only expiring lazily on read/consume path
   - now added a proactive cleanup job

## Risks in original structure
- Background work was mostly **management-command based** and depended on humans/cron discipline.
- No first-class **worker runtime** existed.
- No central **scheduler definition** inside app settings.
- Job exclusivity was partial: payout row locks existed, but job-level scheduler locking was missing.
- Notification enqueue did not actively hand work off to a worker after DB commit.
- Checkout sessions relied too much on lazy expiry instead of proactive cleanup.
- Settlement import existed, but **reprocessing unresolved records** was missing.

## Recommended architecture

### Queue/runtime decision
**Recommended:** Celery + Redis

Why this fits this repo:
- Redis is already present in `docker-compose.yml`
- you have multiple retry/schedule workloads, not just one queue
- beat-style periodic scheduling is needed
- payout + notification + reconciliation jobs justify a real worker system
- lock/retry/backoff semantics map well to Celery tasks + existing DB state machines

### Why not only cron?
Cron alone is acceptable as fallback, but weak as the primary model because:
- no first-class task invocation from request-time events
- no unified retry layer
- harder observability per task
- weaker operational discipline when the system grows

### Why not Dramatiq or RQ?
- Both can work.
- For this repo, Celery wins because periodic scheduling (`beat`), maturity, and operational conventions are stronger for the exact job mix you have.

## What was added

### Infrastructure
- `halkyemekproject/celery.py`
- Celery-safe package export in `halkyemekproject/__init__.py`
- Celery settings in `halkyemekproject/settings/base.py`
- `worker` and `beat` services in `docker-compose.yml`
- Celery dependency entries in `requirements.txt`

### Shared lock layer
- `common/locks.py`
- cache-based job lease / scheduler exclusivity

### Generic task bridge
- `common/tasks.py`

### Notification async handoff
- `notifications/tasks.py`
- `notifications/services.py` now schedules delivery after transaction commit
- `process_notifications` command now has job lock support

### Payout periodic tasks
- `payouts/tasks.py`
- locked command execution for:
  - `dispatch_due_payouts`
  - `run_payout_eligibility`
  - `sync_sent_payout_statuses`

### Settlement / anomaly periodic tasks
- `payments/tasks.py`
- new command: `payments/management/commands/reprocess_unmatched_settlement_records.py`
- locked anomaly command execution

### Checkout cleanup
- `orders/tasks.py`
- new command: `orders/management/commands/cleanup_checkout_sessions.py`

### Operational docs updated
- `RUNBOOK.md`
- `RUN_SCHEDULE.md`
- `.env.example`

## Final recommended job map

### Request-triggered async
- notification delivery kickoff after `NotificationService.enqueue()` commit

### Beat / periodic
- every minute: notifications
- every 5 minutes: payout dispatch
- every 5 minutes: payout provider sync
- every 5 minutes: checkout session cleanup
- every 15 minutes: unresolved settlement reprocess
- hourly: payout eligibility
- hourly: integrity scan
- hourly: anomaly scan
- daily/manual window: settlement CSV import

## File-by-file change summary
- `requirements.txt`: Celery/Redis dependencies
- `docker-compose.yml`: worker + beat services
- `halkyemekproject/__init__.py`: safe celery export
- `halkyemekproject/celery.py`: celery app bootstrap
- `halkyemekproject/settings/base.py`: broker/backend/task/beat config
- `common/locks.py`: distributed job lease
- `common/tasks.py`: generic command bridge task
- `notifications/services.py`: async dispatch handoff on commit
- `notifications/tasks.py`: notification tasks
- `notifications/management/commands/process_notifications.py`: lock-aware command
- `payouts/tasks.py`: payout periodic tasks
- `payouts/management/commands/run_payout_eligibility.py`: lock-aware command
- `payouts/management/commands/dispatch_due_payouts.py`: lock-aware command
- `payouts/management/commands/sync_sent_payout_statuses.py`: lock-aware command
- `payments/tasks.py`: anomaly / settlement reprocess tasks
- `payments/management/commands/reprocess_unmatched_settlement_records.py`: new retry command
- `payments/management/commands/report_financial_anomalies.py`: lock-aware command
- `orders/tasks.py`: checkout cleanup task
- `orders/management/commands/cleanup_checkout_sessions.py`: proactive stale session cleanup
- `RUNBOOK.md`, `RUN_SCHEDULE.md`, `.env.example`: operational updates

## Important remaining gap
`import_iyzico_settlement` is still a **file ingestion** job. That is correct for now. In production, the next step is not making it a blind periodic task; the next step is designing a controlled ingestion source:
- SFTP / object storage drop
- admin upload endpoint
- provider settlement file fetcher with checksum + import registry

That should be a separate hardening step.

## Validation note
Static Python compilation succeeded for the new/edited modules.
Full Django test execution was **not run in this container** because Django and project dependencies are not installed in the execution environment.
