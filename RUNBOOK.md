# HalkYemek Ops Runbook

## Local development quickstart (Windows + PowerShell)

Önerilen yerel sürümler:
- Python: 3.12.x
- Node.js: 20.x veya 22.x
- npm: 10.x

### 1. Backend
```powershell
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py check
python manage.py migrate
python manage.py runserver
```

Backend ilk kontrol URL'leri:
- `http://127.0.0.1:8000/health/`
- `http://127.0.0.1:8000/health/readiness/`
- `http://127.0.0.1:8000/health/metrics/?token=dev-metrics-token`

### 2. Frontend
```powershell
cd frontend
Copy-Item .env.example .env.local
npm ci
npm run typecheck
npm run build
npm run dev
```

Frontend ilk kontrol URL'leri:
- `http://localhost:3000/`
- `http://localhost:3000/giris`
- `http://localhost:3000/isletmeler`

### 3. Yerel çalışma sırası
1. Backend env dosyasını oluştur.
2. Python sanal ortamını açıp backend bağımlılıklarını kur.
3. `python manage.py migrate` çalıştır.
4. `python manage.py runserver` ile backend'i kaldır.
5. Ayrı PowerShell penceresinde frontend'e girip `npm ci` ve `npm run dev` çalıştır.
6. Sonrasında `npm run typecheck` ve `npm run build` ile frontend doğrulamasını al.

## Health
- `GET /health/` => process ok
- `GET /health/readiness/` => app is ready to serve traffic
- `GET /health/metrics/?token=...` => Prometheus-style metrics when authorized
  - Production default: query token kapali (`METRICS_ALLOW_QUERY_TOKEN=False`), Authorization header kullan

## Runtime topology
- `web`: Django API served by Gunicorn (`gunicorn.conf.py`)
- `worker-notifications`: Celery worker for `notifications,default`
- `worker-ops`: Celery worker for `ops,default`
- `worker-finance`: Celery worker for `finance,default`
- `worker-ops-heavy`: Celery worker for `ops_heavy,default`
- `beat`: Celery beat for periodic scheduling
- `redis`: broker + cache + lightweight distributed lock store
- `db`: Postgres
- release phase script: `scripts/release.sh` (runs migrations + collectstatic + env example validation + bootstrap seed/verification + final preflight once)
- web entrypoint: `scripts/prestart.sh` (non-mutating in staging/prod unless env explicitly enables release actions)
- worker startup script: `scripts/run_celery_worker.sh`
- beat startup script: `scripts/run_celery_beat.sh`
- production rule: exactly one beat instance per environment
- staging/prod worker and beat startup scripts run `python manage.py check --deploy` and `python manage.py migrate --check` before process boot
- worker recycle: `CELERY_MAX_TASKS_PER_CHILD` (default `1000`) memory leak riskini azaltir

## Background jobs
1. Notifications enqueue: `python manage.py process_notifications --limit 100 --worker ops1`
2. Payout eligibility: `python manage.py run_payout_eligibility --worker ops1`
3. Payout dispatch: `python manage.py dispatch_due_payouts --worker ops1 --limit 50`
4. Payout provider sync: `python manage.py sync_sent_payout_statuses --worker ops1 --limit 50`
5. Settlement reprocess: `python manage.py reprocess_unmatched_settlement_records --worker ops1 --limit 100`
6. Settlement inbox import: `python manage.py import_pending_settlement_files --worker ops1 --limit 20`
7. Checkout cleanup: `python manage.py cleanup_checkout_sessions --worker ops1 --limit 500`
8. Integrity: `python manage.py verify_financial_integrity`
9. Anomalies: `python manage.py report_financial_anomalies`

`process_notifications` only enqueues due attempts. Actual push delivery happens on `worker-notifications` via `notifications` queue.

Job locks are cache-based and auto-refresh while the owning command is alive. If a command prints `Skipped: ... lock is already held`, another scheduler lane is already running it.
Beat tasks are published with bounded `expires` windows to avoid replaying stale scheduler backlog after outages.
Notification delivery workers use short send-lock leases (`NOTIFICATION_SEND_LOCK_TTL_SECONDS`) to prevent duplicate concurrent sends of the same attempt.

## Webhooks
- Endpoint: `/api/v1/payments/webhooks/iyzico/`
- Signature: `X-IYZ-SIGNATURE-V3`
- Replay guard: `ProviderEvent(provider,event_id)` unique

## Settlement
- File import: `python manage.py import_iyzico_settlement path/to.csv`
- Inbox sweep import: `python manage.py import_pending_settlement_files --limit 20`
- Auto reprocess unresolved locals: `python manage.py reprocess_unmatched_settlement_records --limit 100`
- Rule: settlement records must reconcile to real local entities
- Inbox mode moves successful files to `SETTLEMENT_IMPORT_ARCHIVE_DIR` and failures to `SETTLEMENT_IMPORT_FAILED_DIR`.

## Payout
1. Eligibility sweep: `python manage.py run_payout_eligibility`
2. Create batch: `python manage.py create_payout_batch`
3. Dispatch due payouts: `python manage.py dispatch_due_payouts --worker ops1`
4. Provider sync: `python manage.py sync_sent_payout_statuses --limit 50`
5. Confirm payout manually only if provider evidence exists: `python manage.py confirm_payout <id> --note "bank ok"`

### Payout operational guarantees
- Every dispatch/status interaction now persists provider payload snapshots on `Payout.provider_dispatch_payload` and `Payout.provider_status_payload`.
- `PAYOUT_MAX_ATTEMPTS` is enforced for both dispatch and sent-status retries; only definitive provider failures move payout to `FAILED` and return earnings to `ELIGIBLE`.
- Retryable/ambiguous exhaustion paths are kept for manual review (no automatic earning release) to prevent double-transfer risk.
- `provider_item_reference_code` is persisted on provider-driven confirmation for audit and reconciliation.

## Checkout cleanup
- Expire stale sessions: `python manage.py cleanup_checkout_sessions --limit 500`

## Backup
- Daily: `scripts/backup_postgres.sh`
- Optional backup target directory: `BACKUP_DIR=/secure/path scripts/backup_postgres.sh`
- Restore rehearsal: `RESTORE_CONFIRM=restore-$POSTGRES_DB scripts/restore_postgres.sh <backup.sql.gz>`
- Backup output now includes `--clean --if-exists` for deterministic logical restore
- Backup output integrity: optional `*.sha256` file is generated when `sha256sum` exists
- Restore script `*.sha256` varsa otomatik dogrular ve `psql -1` ile transaction içinde calisir

## Environment contracts
- staging template: `.env.staging.example`
- prod template: `.env.prod.example`
- `TRUST_X_FORWARDED_FOR=True` only behind a trusted reverse proxy/load balancer
- `TRUST_X_FORWARDED_FOR=True` ise `TRUSTED_PROXY_IPS` zorunlu; aksi halde forwarded header'lar guvenilmez
- edge proxy/load balancer `X-Forwarded-For` ve `X-Real-IP` header'larini disaridan oldugu gibi gecirmemeli; strip/overwrite ederek yeniden yazmali
- `METRICS_IP_ALLOWLIST` ve `IYZICO_WEBHOOK_IP_ALLOWLIST` tekil IP veya CIDR kabul eder (`10.0.0.0/8` gibi)
- `SCHEDULER_HEARTBEAT_TTL_SECONDS` must stay above `CELERY_BEAT_MAX_LOOP_INTERVAL`
- settlement import dizinleri (`INBOX/ARCHIVE/FAILED`) ya birlikte bos ya birlikte dolu ve birbirinden farkli olmali

## Incident checklist
- Celery worker alive mı?
- Celery beat alive mı?
- Tek beat mi calisiyor?
- Redis erişimi var mı?
- Son job heartbeat ne zaman güncellendi?
- `celery_beat_scheduler` heartbeat güncel mi?
- `import_pending_settlement_files` heartbeat güncel mi?
- `worker-notifications` queue tuketiyor mu? (`notifications` backlog artiyor mu?)
- Webhook secret / provider erişimi doğru mu?
- `verify_financial_integrity` ve `report_financial_anomalies` çıktılarını tekrar çalıştır
- Gerekirse payout dispatcher'ı durdur, settlement import ve payout confirm süreçlerini manual review moduna al

## Staging prove-out
- Run `BASE_URL=https://staging-api.example.com EXPECTED_RELEASE=<release> scripts/staging_prove_out.sh` after release rollout completes
- This flow verifies final preflight, finance integrity scans, Celery worker/beat health, and external HTTP smoke checks together
## Sprint 5 accounting notes
- Checkout/order accounting is cart-backed: `subtotal_amount` comes from cart line totals, `customer_fee_amount` is the fixed customer fee, and `total_payable_amount` / wallet debit is `subtotal + customer_fee`.
- Business earning uses merchant-side economics only: `gross_amount=subtotal_amount`, `platform_fee_amount=business_fee_amount`, `net_amount=subtotal_amount-business_fee_amount`.
- Integrity/anomaly commands now compare `Order` columns, `pricing_snapshot`, and `BusinessEarning` rows together. Any drift between these three layers is a release blocker.
- Refund / reversal / chargeback flows may either shrink mutable payout items before dispatch or create next-cycle negative `PayoutAdjustment` rows after payout lock/confirmation.


## Settlement ingestion kontrol yüzeyi
- API upload: `POST /api/v1/payments/ops/settlement/imports/upload/` (admin only, multipart `file`)
- Import liste/detay: `GET /api/v1/payments/ops/settlement/imports/` ve `GET /api/v1/payments/ops/settlement/imports/<id>/`
- Import retry: `POST /api/v1/payments/ops/settlement/imports/<id>/retry/`
- Record liste/detay: `GET /api/v1/payments/ops/settlement/records/` ve `GET /api/v1/payments/ops/settlement/records/<id>/`
- Record manual reprocess: `POST /api/v1/payments/ops/settlement/records/<id>/reprocess/`
- Record review/note: `PATCH /api/v1/payments/ops/settlement/records/<id>/review/`
- Dashboard: `GET /api/v1/payments/ops/settlement/dashboard/`

### Operasyon akışı
1. Dosya upload API ile yüklenir veya `import_iyzico_settlement path/to.csv` komutu çalıştırılır.
2. Sistem dosyanın SHA-256 checksum değerini çıkarır, `SettlementImport` registry kaydı açar ve `imported_by`, `source_label`, `source_metadata` bilgisini lifecycle event içine yazar.
3. Aynı checksum daha önce kaydedildiyse import reddedilir. API yüzeyi `existing_import` payload döner; inbox sweep aynı dosyayı hata yerine `duplicate` sayıp archive eder.
4. Import state zinciri şu şekildedir: `NOT_STARTED -> PARSING/APPLYING -> PARSED/APPLIED` veya hata halinde `FAILED`. Çalışan import retry edilemez.
5. Başarılı import sonrası `SettlementRecord` satırları import kaydına bağlanır; summary alanları `created/duplicates/processed/errors/skipped/unmatched` olarak görünür.
6. `is_processed=False` kalan kayıtlar ops listesinde `review_status`, `unmatched_reason_code`, `unmatched_reason_label`, `next_action`, `stale_manual_review`, `operator_note` ile yönetilir.
7. Manual inceleme sonrası iki yol vardır: tek kayıt için record reprocess, bütün dosya için import retry.

### Unmatched lifecycle
- `OPEN`: kayıt eşleşmedi, operatör incelemesi bekliyor.
- `ACKNOWLEDGED`: operatör gördü ama henüz çözmedi.
- `RETRY_SCHEDULED`: manuel veya otomatik yeniden işleme kuyruğuna alındı.
- `RESOLVED`: kayıt işlendi ve settlement etkisi sisteme geçti.
- `IGNORED`: veri silinmez; sadece operatör bu satırı bilerek beklemeye aldı anlamına gelir.
- `stale_manual_review=true`: açık unmatched kayıt belirlenen SLA eşiğini aştı; dashboard ve liste filtrelerinde görünür.

### Retry / rollback notları
- Duplicate guard checksum bazlıdır; aynı dosyayı yeniden yüklemek rollback yerine retry üretmez.
- Kod veya referans veri düzeltmesi sonrası tekrar denenecekse mevcut import kaydı `retry` endpointi veya kontrollü servis çağrısı ile yeniden çalıştırılmalıdır.
- `review_status=IGNORED` sadece operatör kararıdır; finansal veri silmez.
- `RETRY_SCHEDULED` manuel tekrar deneme işaretidir; background reprocess ile çakışma job lock üzerinden engellenir.
- `import_pending_settlement_files` heartbeat meta alanında `imported`, `duplicates`, `failed`, `skipped`, `duplicate_files`, `failures` tutulur. Operatör önce dashboard heartbeat meta bilgisini kontrol etmelidir.
- Gerçek rollback yoktur; settlement satırı yazıldıktan sonra çözüm yolu yeni import, controlled retry veya manual review üzerinden ilerler.

## Bootstrap
- Resmi discovery seed komutu: `python manage.py bootstrap_marketplace --district BEYLIKDUZU`
- Seed dogrulama komutu: `python manage.py verify_bootstrap_marketplace --district BEYLIKDUZU`
- Release phase icinde `RUN_BOOTSTRAP_MARKETPLACE=1` ve `RUN_VERIFY_BOOTSTRAP_MARKETPLACE=1` ise otomatik calisir.
- Seed fixture referansi: `businesses/fixtures/marketplace_categories_beylikduzu.json`
- Komut idempotenttir; ayni seed kayitlarini ciftlemez.


## Refund / reversal / chargeback operasyon matrisi
- Ops order refund: `POST /api/v1/payments/ops/orders/<order_id>/refund/`
- Ops topup reversal: `POST /api/v1/payments/ops/intents/<intent_id>/topup-reversal/`
- Ops chargeback: `POST /api/v1/payments/ops/chargebacks/`
- Ops manual-review resolution: `POST /api/v1/payments/ops/reversals/<reversal_id>/resolve/`

### Ürün kararı: insufficient balance / debt / block
- Topup reversal veya payment-intent chargeback geldiğinde sistem önce `pending_balance` içindeki tutarı tersler.
- Kalan tutar için kullanıcının `available balance` bakiyesi varsa anında tahsil eder.
- Hâlâ açık kalan exposure varsa reversal `REQUESTED + review_status=OPEN` durumda bırakılır.
- Bu durumda wallet otomatik bloklanır: yeni harcama/consume engellenir, ancak yeni topup kabul edilir.
- Açık exposure `PaymentReversal.outstanding_exposure_amount` alanında tutulur.
- Ops ekipleri kullanıcı yeni bakiye yükledikten sonra `.../resolve/` endpointi ile tahsilatı tamamlar; exposure sıfırlanınca wallet blokajı kalkar.

### Provider mapping
- Mock provider: `payment.order_refund`, `payment.order_chargeback`, `payment.reversal`, `payment.chargeback`
- iyzico webhook: reversal / chargeback payload'ları `PaymentReversalService` üzerinden resmi domain reversal kaydına çevrilir.
- Aynı provider event ikinci kez gelirse `ProviderEvent` + reversal unique guard + hashed idempotency ile duplicate etki oluşmaz.

