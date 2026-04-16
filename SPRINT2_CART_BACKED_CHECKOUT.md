# Sprint 2: Cart-Backed Checkout and Fixed-Fee Pricing

## What changed

Sprint 2 replaces single-item checkout initiation with a cart-backed flow and introduces a centralized fixed-fee pricing engine.

### Old flow

- Checkout session was created directly from one `menu_item_id`.
- Order consume assumed single-item structure.
- Pricing logic was not fully centralized for customer fee + business fee breakdown.

### New flow

- Cart is the source of truth before checkout.
- Checkout session is created from active cart snapshot.
- Consume finalizes `Order` + multiple `OrderItem` entries from checkout/cart snapshot.
- Wallet debit uses `total_payable`.
- Business earning uses `subtotal/business_fee/business_net`.

## Central pricing model

All amounts are integer kurus.

- `subtotal_amount` = sum of cart line totals
- `customer_fee_amount` = `CUSTOMER_FIXED_FEE_KURUS`
- `business_fee_amount` = `BUSINESS_FIXED_FEE_KURUS`
- `total_payable_amount` = `subtotal_amount + customer_fee_amount`
- `business_net_amount` = `subtotal_amount - business_fee_amount`
- `platform_total_fee_amount` = `customer_fee_amount + business_fee_amount`

Configurable settings:

- `CUSTOMER_FIXED_FEE_KURUS` (default `1000`)
- `BUSINESS_FIXED_FEE_KURUS` (default `1000`)

Guardrails:

- Non-positive subtotal is rejected.
- Negative business net is rejected.

## Cart service and API

Service layer (`orders/services_cart.py`):

- Active cart lifecycle and recomputation
- Add/update/remove/clear operations
- Cross-business guard
- Menu/business/category availability guard
- Snapshot and totals recomputation

API surface:

- `GET /api/v1/cart/`
- `POST /api/v1/cart/items/`
- `PATCH /api/v1/cart/items/<item_id>/`
- `DELETE /api/v1/cart/items/<item_id>/`
- `DELETE /api/v1/cart/clear/`
- `GET /api/v1/cart/checkout-preview/`

## Checkout/consume safety

- Checkout create uses idempotency scope `orders.checkout_session_create`.
- Create path computes/reuses session inside idempotent action to avoid side effects on payload mismatch.
- Consume remains `transaction.atomic` and uses `select_for_update` on checkout session and wallet.
- Duplicate consume is blocked via session status and existing order checks.
- Wallet immutable ledger safeguards are preserved through `WalletService.purchase(order=...)`.

## Snapshoting strategy

- Cart recomputation stores pricing + item snapshot on cart.
- Checkout session stores pricing + cart snapshots at create time.
- Order stores pricing snapshot + checkout/cart context in order snapshot at consume time.

## Compatibility/evolution notes

- `CheckoutSession.menu_item` remains nullable for controlled compatibility.
- Create endpoint still accepts optional `menu_item_id`; when provided, it adds to cart and continues with cart-backed create.
- Preferred contract is active-cart based create without requiring `menu_item_id`.

## Verification done

- Full `orders.tests` package passes.
- Focused Sprint 2 suites pass (`checkout`, `cart`, `throttling`, `pricing`, cleanup).
- `makemigrations --check --dry-run` reports no pending changes.
