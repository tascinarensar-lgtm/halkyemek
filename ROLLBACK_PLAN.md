# HalkYemek Rollback Plan

## Trigger rollback if
- Repeated 5xx increase after deploy
- Payment flow breaks
- Settlement import breaks
- Payout confirmation behaves unexpectedly
- Notification processing fails globally

## Rollback steps
1. Stop new deploy rollout
2. Switch app image to previous stable tag
3. Do not re-run release phase unless the rollback image requires a known-safe backward-compatible migration step
4. Restart web container
5. Restart `worker-notifications`, `worker-ops`, `worker-finance`, `worker-ops-heavy`, and `beat`
6. Verify:
   - /health/
   - /health/readiness/
   - /health/readiness/?strict=1
   - Google login
   - payment create
7. Review migrations:
   - If backward-compatible: keep DB as-is
   - If destructive migration shipped: execute prepared DB rollback plan
8. Run:
   - `python manage.py verify_financial_integrity`
   - `python manage.py report_financial_anomalies`

## Notes
- Never rollback blindly during active settlement import
- Never confirm payouts manually without proof
- Preserve audit logs
- Rollback sonrasi ilk finansal kontrol: cart-backed order accounting snapshot drift var mi diye `verify_financial_integrity` outputunu incele.

## Bootstrap rollback notu
- Bootstrap komutu yalnizca resmi marketplace kategori kayitlarini idempotent sekilde olusturur/gunceller.
- Rollback gerekiyorsa deployment geri alinmadan once category seed drift'i admin veya shell uzerinden kontrol edilmelidir.
