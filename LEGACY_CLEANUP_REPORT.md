# Legacy / Compatibility Final Cleanup Report

## Final domain decisions

### 1) `BusinessProfile.user`
- Final semantic meaning: **metadata/KYC contact user only**.
- Authorization is **never** derived from this relation.
- Business authority stays on `BusinessMember`.
- Code was cleaned to prefer `contact_user` / `contact_user_id` semantic accessors while keeping the DB field for backward compatibility.
- A destructive migration can remove the column later only after every caller is fully moved away from the raw field name.

### 2) Membership authority
- Final authority source:
  - `BusinessMember`
  - `user_has_business_membership(...)`
  - `user_has_business_role(...)`
  - `IsBusinessMember`
  - `IsBusinessManagerOrOwner`
  - `IsBusinessCashierOrAbove`
- Duplicate `IsBusinessMember` definitions were collapsed into a single canonical source by re-exporting from `businesses.permissions`.

### 3) Notification/contact fallback rules
- Notification target resolution remains membership-based.
- Contact fallback is not used for operational/financial targeting.
- Legacy GSM fallback from `User.phone` was removed because the custom `User` model does not define a phone field.
- Final GSM source is business KYC metadata: `BusinessProfile.kyc_gsm_number`.

### 4) `BusinessEarning.amount`
- `net_amount` is the final business semantic amount.
- `amount` remains only as a compatibility mirror for older rows / code paths.
- Model save logic was simplified so `amount` mirrors `net_amount` deterministically.
- `outstanding_amount` convenience property was added.

## Files changed
- `businesses/models.py`
- `businesses/services/membership.py`
- `businesses/api/views_ops.py`
- `accounts/api/permissions.py`
- `orders/api/permissions.py`
- `payouts/models.py`
- `test_support.py`

## Repo hygiene
- Removed `__pycache__` folders and `*.pyc` artifacts from the delivered archive.

## Recommended next destructive cleanup phase
1. Rename `BusinessProfile.user` -> `contact_user` at DB level with a real migration.
2. Remove `BusinessEarning.amount` after all readers switch to `net_amount`.
3. Review response payload aliases like `is_business_member` only after frontend/admin clients are updated.
4. Remove any migrations/tests that still encode transition-era wording once production data no longer depends on them.
