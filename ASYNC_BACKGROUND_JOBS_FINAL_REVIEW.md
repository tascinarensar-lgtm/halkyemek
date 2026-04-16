# Async / Worker / Scheduler Final Review

## Scope
Bu çalışma sadece background jobs, scheduler, worker ve async operasyon modelini kapsar.

## Mevcut durumda bulduğum ana problemler
1. Celery zaten eklenmişti ama queue ayrımı yoktu; bütün işler tek worker lane'e yığılabilecek durumdaydı.
2. Job-level cache lock token'ı doğrudan `worker` string'i idi. TTL aşımı sonrası aynı job ikinci kez başlarsa eski süreç yeni lock'u yanlışlıkla silebilirdi.
3. Strict readiness, `cleanup_checkout_sessions` ve `reprocess_unmatched_settlement_records` heartbeat'lerini izlemiyordu.
4. Metrics tarafında da aynı iki kritik scheduled job görünmüyordu.
5. Docker compose tek worker ile tanımlıydı; finansal işler ile notification işleri aynı lane'de karışıyordu.
6. Task dosyalarında operational kimlik (`worker`) ve queue niyeti net değildi.

## Uyguladığım onarımlar
- Queue ayrımı kuruldu: `notifications`, `ops`, `finance`, `ops_heavy`, `default`
- Task routing tanımlandı.
- `worker-default` ve `worker-ops` olarak iki worker lane oluşturuldu.
- Cache lock için benzersiz invocation token üretimi eklendi.
- İlgili management command'ler benzersiz lock token kullanacak şekilde düzeltildi.
- Readiness kontrollerine `checkout_cleanup_job_recent` ve `settlement_reprocess_job_recent` eklendi.
- Metrics tarafına aynı heartbeat metrikleri eklendi.
- Runbook / schedule / deployment notları queue-separated model ile güncellendi.

## Final operasyon modeli
- Beat sadece schedule üretir.
- Kısa operasyon sweep'leri `ops` queue'sunda çalışır.
- Notification gönderim işleri `notifications` queue'sunda çalışır.
- Payout / settlement retry işleri `finance` queue'sunda çalışır.
- Integrity ve anomaly scan gibi ağır işler `ops_heavy` queue'sunda çalışır.
- Management command'ler ad-hoc ops surface olarak korunur; task'ler ise otomatik runtime yoludur.

## Not
Bu container içinde Django bağımlılıkları kurulu olmadığı için tam test suite çalıştırılamadı. Değiştirilen Python dosyalarında sentaktik kontrol yapıldı.
