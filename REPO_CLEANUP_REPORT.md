# Repo Cleanup Report

## Yapılan temizlik
- Placeholder `core` app tamamen kaldırıldı.
- Placeholder `qr` app tamamen kaldırıldı.
- Boş / kullanılmayan dosyalar kaldırıldı:
  - `accounts/api/serializers.py`
  - `common/admin.py`
  - `common/models.py`
  - `common/tests.py`
  - `common/views.py`
  - `health/admin.py`
  - `logs/views.py`
  - `menus/api/views.py`
  - `menus/views.py`
  - `notifications/admin.py`
  - `orders/urls.py`
  - `orders/views.py`
  - `payments/admin.py`
  - `payouts/admin.py`
  - `load/k6_smoke.js`
- Repo içindeki geçici test/cache artıkları kaldırıldı:
  - `.pytest_cache/`
  - `__pycache__/` klasörleri
- Analiz çıktısı olarak repoda duran operasyon dışı rapor dosyaları kaldırıldı:
  - `FINAL_ARCHITECTURE_CLEANUP_REPORT.md`
  - `LEGACY_COMPATIBILITY_CLEANUP_REPORT.md`
  - `OPS_ADMIN_SIMPLIFICATION_REPORT.md`
  - `PAYOUT_DISPATCH_IYZICO_ANALYSIS.md`
- `.gitignore` genişletildi.

## Kasıtlı olarak bırakılanlar
- `common`, `health`, `logs` gibi app’lerde iş yapan kodlar bırakıldı.
- Runtime/operasyon için anlamlı görünen dökümanlar bırakıldı: `RUNBOOK.md`, `GO_LIVE_CHECKLIST.md`, `ROLLBACK_PLAN.md`, `RUN_SCHEDULE.md`, `DEPLOYMENT_CHECKLIST.md`.
- Domain testleri bırakıldı; sadece placeholder test dosyaları temizlendi.

## Not
Bu ortamda Django bağımlılıkları kurulu olmadığı için tam test çalıştırılamadı. Temizlik, statik repo incelemesi ve import/URL referanslarına göre yapıldı.
