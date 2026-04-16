# Iyzico Submerchant Onboarding Refactor Report

## What was changed
- Added `NEEDS_REVIEW` state to both local onboarding lifecycle and iyzico submerchant lifecycle.
- Added `iyzico_last_response` JSON snapshot field to `BusinessProfile` so the latest provider response is stored.
- Reworked `payments/providers/iyzico_marketplace.py` to distinguish:
  - provider/business validation failures -> `REJECTED`
  - retryable transport / timeout / 5xx failures -> `NEEDS_REVIEW`
  - detail-side approval waiting states -> `PENDING`
  - active provider state -> `ACTIVE`
- Kept the ops onboarding trigger centralized in `businesses/services/ops_onboarding.py` and aligned `payout_onboarding_status` with the true provider lifecycle.
- Exposed `iyzico_last_response` in ops business detail output for troubleshooting.
- Added migrations to resolve the pre-existing split migration branch and then introduce the new onboarding fields/state choices.
- Expanded tests around:
  - active success path
  - rejected provider validation path
  - pending approval path
  - needs-review network path
  - ops endpoint behavior for approved / needs-review outcomes

## Files changed
- `businesses/models.py`
- `businesses/services/ops_onboarding.py`
- `businesses/api/views_ops.py`
- `payments/providers/iyzico_marketplace.py`
- `payments/tests/test_iyzico_marketplace_provider.py`
- `businesses/tests/test_ops_admin_surface.py`
- `businesses/migrations/0011_merge_0008_branches.py`
- `businesses/migrations/0012_businessprofile_onboarding_review_fields.py`

## Notes
- The repository currently contains a pre-existing migration branch split in `businesses` (`0008_businessmember.py` and `0008_businessprofile_kyc_tax_office.py`). I added a merge migration before the new schema migration.
- I could not run Django test suite in this environment because Django is not installed here; I did run Python syntax compilation on the edited files.
