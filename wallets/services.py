from __future__ import annotations

from dataclasses import dataclass

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from payments.models import PaymentIntent, ProviderEvent

from .models import PendingWalletTransaction, Wallet, WalletTransaction


@dataclass(frozen=True)
class MoneyResult:
    wallet: Wallet
    tx: WalletTransaction


class WalletService:
    @staticmethod
    def _resolve_provider_event(provider_event=None, provider_event_id: str | None = None) -> ProviderEvent | None:
        if provider_event is not None:
            return provider_event
        if provider_event_id:
            return ProviderEvent.objects.filter(event_id=provider_event_id).first()
        return None

    @staticmethod
    def _resolve_payment_intent(payment_intent=None, payment_intent_id: int | None = None) -> PaymentIntent | None:
        if payment_intent is not None:
            return payment_intent
        if payment_intent_id:
            return PaymentIntent.objects.filter(id=payment_intent_id).first()
        return None

    @staticmethod
    def get_or_create_wallet(*, user) -> Wallet:
        wallet = Wallet.objects.filter(user=user).first()
        if wallet is not None:
            return wallet

        try:
            with transaction.atomic():
                return Wallet.objects.create(user=user)
        except IntegrityError:
            wallet = Wallet.objects.filter(user=user).first()
            if wallet is None:
                raise
            return wallet

    @staticmethod
    def _get_wallet_for_update(*, user) -> Wallet:
        wallet = Wallet.objects.select_for_update().filter(user=user).first()
        if wallet is not None:
            return wallet

        try:
            with transaction.atomic():
                return Wallet.objects.create(user=user)
        except IntegrityError:
            wallet = Wallet.objects.select_for_update().filter(user=user).first()
            if wallet is None:
                raise
            return wallet

    @staticmethod
    def _ensure_wallet_is_operable(*, wallet: Wallet) -> None:
        if not wallet.is_active:
            reason = str(getattr(wallet, "restriction_reason", "") or "").strip()
            if reason:
                raise ValidationError(f"Wallet is inactive: {reason}")
            raise ValidationError("Wallet is inactive")

    @staticmethod
    def restrict_wallet(*, wallet: Wallet, reason: str) -> Wallet:
        wallet.is_active = False
        wallet.restriction_reason = str(reason or "")[:255]
        wallet.restricted_at = timezone.now()
        wallet.save(update_fields=["is_active", "restriction_reason", "restricted_at", "updated_at"])
        return wallet

    @staticmethod
    def release_wallet_restriction(*, wallet: Wallet, reason_prefix: str | None = None) -> Wallet:
        current_reason = str(getattr(wallet, "restriction_reason", "") or "")
        if reason_prefix and current_reason and not current_reason.startswith(str(reason_prefix)):
            return wallet
        wallet.is_active = True
        wallet.restriction_reason = ""
        wallet.restricted_at = None
        wallet.save(update_fields=["is_active", "restriction_reason", "restricted_at", "updated_at"])
        return wallet

    @staticmethod
    def _assert_wallet_ledger_in_sync(*, wallet: Wallet) -> None:
        before = int(wallet.balance)
        last = WalletTransaction.objects.filter(wallet=wallet).order_by("-id").first()
        if last and int(last.after_balance) != before:
            raise ValidationError(
                f"Ledger drift detected: wallet.balance={before} but last.after_balance={int(last.after_balance)}. "
                "Run wallet reconcile before continuing."
            )
        ledger_sum = WalletTransaction.objects.filter(wallet=wallet).aggregate(total=Sum("amount"))["total"] or 0
        if int(ledger_sum) != before:
            raise ValidationError(
                f"Ledger drift detected: wallet.balance={before} but ledger_sum={int(ledger_sum)}. "
                "Run wallet reconcile before continuing."
            )

    @staticmethod
    def _assert_pending_ledger_in_sync(*, wallet: Wallet) -> None:
        before_pending = int(wallet.pending_balance)
        last = PendingWalletTransaction.objects.filter(wallet=wallet).order_by("-id").first()
        if last and int(last.after_pending) != before_pending:
            raise ValidationError(
                f"Pending ledger drift detected: wallet.pending_balance={before_pending} but "
                f"last.after_pending={int(last.after_pending)}."
            )
        pending_sum = PendingWalletTransaction.objects.filter(wallet=wallet).aggregate(total=Sum("amount"))["total"] or 0
        if int(pending_sum) != before_pending:
            raise ValidationError(
                f"Pending ledger drift detected: wallet.pending_balance={before_pending} but "
                f"pending_sum={int(pending_sum)}."
            )

    @staticmethod
    def _apply_pending(
        *,
        wallet: Wallet,
        tx_type: str,
        amount: int,
        description: str,
        provider_event=None,
        payment_intent=None,
        allow_inactive: bool = False,
    ):
        if not allow_inactive:
            WalletService._ensure_wallet_is_operable(wallet=wallet)
        WalletService._assert_pending_ledger_in_sync(wallet=wallet)

        before = int(wallet.pending_balance)
        after = before + int(amount)
        if after < 0:
            raise ValidationError("Pending balance 0 altına inemez")

        tx = PendingWalletTransaction.objects.create(
            wallet=wallet,
            transaction_type=tx_type,
            amount=int(amount),
            before_pending=before,
            after_pending=after,
            provider_event=provider_event,
            payment_intent=payment_intent,
            description=description or "",
        )
        wallet.pending_balance = after
        wallet.save(update_fields=["pending_balance", "updated_at"])
        return tx

    def get_wallet_integrity_snapshot(*, wallet: Wallet) -> dict:
        wallet_sum = WalletTransaction.objects.filter(wallet=wallet).aggregate(total=Sum("amount"))["total"] or 0
        pending_sum = PendingWalletTransaction.objects.filter(wallet=wallet).aggregate(total=Sum("amount"))["total"] or 0
        wallet_last = WalletTransaction.objects.filter(wallet=wallet).order_by("-id").first()
        pending_last = PendingWalletTransaction.objects.filter(wallet=wallet).order_by("-id").first()
        return {
            "wallet_balance": int(wallet.balance),
            "wallet_sum": int(wallet_sum),
            "wallet_last_after": int(wallet_last.after_balance) if wallet_last else 0,
            "wallet_in_sync": int(wallet.balance) == int(wallet_sum) == (int(wallet_last.after_balance) if wallet_last else 0),
            "pending_balance": int(wallet.pending_balance),
            "pending_sum": int(pending_sum),
            "pending_last_after": int(pending_last.after_pending) if pending_last else 0,
            "pending_in_sync": int(wallet.pending_balance) == int(pending_sum) == (int(pending_last.after_pending) if pending_last else 0),
        }

    @staticmethod
    @transaction.atomic
    def topup(*, user, amount: int, description: str = "", order=None, provider_event=None, payment_intent=None) -> MoneyResult:
        if amount <= 0:
            raise ValidationError("Topup amount must be > 0")

        wallet = WalletService._get_wallet_for_update(user=user)
        return WalletService._apply(
            wallet=wallet,
            tx_type=WalletTransaction.Type.TOP_UP,
            amount=amount,
            description=description,
            order=order,
            provider_event=provider_event,
            payment_intent=payment_intent,
            allow_inactive=True,
        )

    @staticmethod
    @transaction.atomic
    def purchase(*, user, amount: int, description: str = "", order=None, provider_event=None, payment_intent=None) -> MoneyResult:
        if amount <= 0:
            raise ValidationError("Purchase amount must be > 0")

        wallet = WalletService._get_wallet_for_update(user=user)
        WalletService._ensure_wallet_is_operable(wallet=wallet)
        if wallet.balance < amount:
            raise ValidationError("Yetersiz bakiye")

        return WalletService._apply(
            wallet=wallet,
            tx_type=WalletTransaction.Type.PURCHASE,
            amount=-amount,
            description=description,
            order=order,
            provider_event=provider_event,
            payment_intent=payment_intent,
        )

    @staticmethod
    @transaction.atomic
    def refund(*, user, amount: int, description: str = "", order=None, provider_event=None, payment_intent=None) -> MoneyResult:
        if amount <= 0:
            raise ValidationError("Refund amount must be > 0")

        wallet = WalletService._get_wallet_for_update(user=user)
        WalletService._ensure_wallet_is_operable(wallet=wallet)
        return WalletService._apply(
            wallet=wallet,
            tx_type=WalletTransaction.Type.REFUND,
            amount=amount,
            description=description,
            order=order,
            provider_event=provider_event,
            payment_intent=payment_intent,
        )

    @staticmethod
    @transaction.atomic
    def adjustment(*, user, amount: int, description: str = "", order=None, provider_event=None, payment_intent=None) -> MoneyResult:
        if amount == 0:
            raise ValidationError("Adjustment amount cannot be 0")

        wallet = WalletService._get_wallet_for_update(user=user)
        WalletService._ensure_wallet_is_operable(wallet=wallet)
        if amount < 0 and wallet.balance < abs(amount):
            raise ValidationError("Yetersiz bakiye (adjustment)")

        return WalletService._apply(
            wallet=wallet,
            tx_type=WalletTransaction.Type.ADJUSTMENT,
            amount=amount,
            description=description,
            order=order,
            provider_event=provider_event,
            payment_intent=payment_intent,
        )

    @staticmethod
    def _apply(
        *,
        wallet: Wallet,
        tx_type: str,
        amount: int,
        description: str,
        order=None,
        provider_event=None,
        payment_intent=None,
        allow_inactive: bool = False,
    ) -> MoneyResult:
        if not allow_inactive:
            WalletService._ensure_wallet_is_operable(wallet=wallet)
        WalletService._assert_wallet_ledger_in_sync(wallet=wallet)

        if tx_type == WalletTransaction.Type.PURCHASE and order is not None:
            existing_purchase = WalletTransaction.objects.filter(
                wallet=wallet,
                transaction_type=WalletTransaction.Type.PURCHASE,
                order=order,
            ).first()
            if existing_purchase is not None:
                raise ValidationError("Duplicate purchase for order is not allowed")

        if (
            tx_type in {WalletTransaction.Type.REVERSAL, WalletTransaction.Type.CHARGEBACK}
            and provider_event is not None
            and payment_intent is not None
        ):
            existing_reversal = WalletTransaction.objects.filter(
                wallet=wallet,
                transaction_type=tx_type,
                provider_event=provider_event,
                payment_intent=payment_intent,
            ).first()
            if existing_reversal is not None:
                return MoneyResult(wallet=wallet, tx=existing_reversal)

        before = int(wallet.balance)
        after = before + int(amount)
        if after < 0:
            raise ValidationError("Bakiye 0 altına inemez")

        try:
            tx = WalletTransaction.objects.create(
                wallet=wallet,
                transaction_type=tx_type,
                amount=int(amount),
                before_balance=before,
                after_balance=after,
                order=order,
                description=description or "",
                provider_event=provider_event,
                payment_intent=payment_intent,
            )
        except IntegrityError as exc:
            if tx_type == WalletTransaction.Type.PURCHASE and order is not None:
                existing_purchase = WalletTransaction.objects.filter(
                    wallet=wallet,
                    transaction_type=WalletTransaction.Type.PURCHASE,
                    order=order,
                ).first()
                if existing_purchase is not None:
                    raise ValidationError("Duplicate purchase for order is not allowed") from exc
            raise

        wallet.balance = after
        wallet.save(update_fields=["balance", "updated_at"])
        return MoneyResult(wallet=wallet, tx=tx)

    @staticmethod
    @transaction.atomic
    def reconcile(*, user) -> dict:
        wallet = WalletService._get_wallet_for_update(user=user)
        wallet_sum = WalletTransaction.objects.filter(wallet=wallet).aggregate(total=Sum("amount"))["total"] or 0
        pending_sum = PendingWalletTransaction.objects.filter(wallet=wallet).aggregate(total=Sum("amount"))["total"] or 0

        wallet.balance = int(wallet_sum)
        wallet.pending_balance = int(pending_sum)
        wallet.save(update_fields=["balance", "pending_balance", "updated_at"])
        return WalletService.get_wallet_integrity_snapshot(wallet=wallet)

    @staticmethod
    @transaction.atomic
    def topup_pending(
        *,
        user,
        amount: int,
        description: str = "Topup paid -> pending",
        provider_event=None,
        provider_event_id: str | None = None,
        payment_intent=None,
        payment_intent_id: int | None = None,
    ):
        if amount <= 0:
            raise ValidationError("amount must be positive")

        wallet = WalletService._get_wallet_for_update(user=user)
        WalletService._ensure_wallet_is_operable(wallet=wallet)
        wallet.refresh_from_db(fields=["pending_balance"])
        WalletService._assert_pending_ledger_in_sync(wallet=wallet)

        pe = WalletService._resolve_provider_event(provider_event=provider_event, provider_event_id=provider_event_id)
        pi = WalletService._resolve_payment_intent(payment_intent=payment_intent, payment_intent_id=payment_intent_id)

        if pi is not None:
            existing = PendingWalletTransaction.objects.filter(
                wallet=wallet,
                payment_intent=pi,
                transaction_type=PendingWalletTransaction.Type.TOPUP_PENDING,
            ).first()
            if existing:
                return existing

        return WalletService._apply_pending(
            wallet=wallet,
            tx_type=PendingWalletTransaction.Type.TOPUP_PENDING,
            amount=int(amount),
            description=description,
            provider_event=pe,
            payment_intent=pi,
        )

    @staticmethod
    @transaction.atomic
    def settle_pending_to_available(
        *,
        user,
        amount: int,
        description: str = "Settlement",
        provider_event=None,
        provider_event_id: str | None = None,
        payment_intent=None,
        payment_intent_id: int | None = None,
    ):
        if amount <= 0:
            raise ValidationError("amount must be positive")

        wallet = WalletService._get_wallet_for_update(user=user)
        WalletService._ensure_wallet_is_operable(wallet=wallet)
        wallet.refresh_from_db(fields=["balance", "pending_balance"])
        WalletService._assert_wallet_ledger_in_sync(wallet=wallet)
        WalletService._assert_pending_ledger_in_sync(wallet=wallet)

        pe = WalletService._resolve_provider_event(provider_event=provider_event, provider_event_id=provider_event_id)
        pi = WalletService._resolve_payment_intent(payment_intent=payment_intent, payment_intent_id=payment_intent_id)

        if pi is not None:
            existing = PendingWalletTransaction.objects.filter(
                wallet=wallet,
                payment_intent=pi,
                transaction_type=PendingWalletTransaction.Type.SETTLEMENT_OUT,
            ).first()
            if existing:
                return wallet

        if wallet.pending_balance < amount:
            raise ValidationError("insufficient pending balance for settlement")

        WalletService._apply_pending(
            wallet=wallet,
            tx_type=PendingWalletTransaction.Type.SETTLEMENT_OUT,
            amount=-int(amount),
            description=f"{description} (pending -> available)",
            provider_event=pe,
            payment_intent=pi,
        )

        WalletService._apply(
            wallet=wallet,
            tx_type=WalletTransaction.Type.TOP_UP,
            amount=int(amount),
            description=description,
            provider_event=pe,
            payment_intent=pi,
        )
        return wallet


    @staticmethod
    @transaction.atomic
    def reverse_available_funds(
        *,
        user,
        amount: int,
        tx_type: str = WalletTransaction.Type.REVERSAL,
        description: str = "",
        order=None,
        provider_event=None,
        provider_event_id: str | None = None,
        payment_intent=None,
        payment_intent_id: int | None = None,
        allow_inactive: bool = False,
    ) -> MoneyResult:
        if amount <= 0:
            raise ValidationError("Reversal amount must be > 0")

        wallet = WalletService._get_wallet_for_update(user=user)
        if not allow_inactive:
            WalletService._ensure_wallet_is_operable(wallet=wallet)
        if int(wallet.balance) < int(amount):
            raise ValidationError("Yetersiz bakiye (reversal)")

        pe = WalletService._resolve_provider_event(provider_event=provider_event, provider_event_id=provider_event_id)
        pi = WalletService._resolve_payment_intent(payment_intent=payment_intent, payment_intent_id=payment_intent_id)
        return WalletService._apply(
            wallet=wallet,
            tx_type=tx_type,
            amount=-int(amount),
            description=description,
            order=order,
            provider_event=pe,
            payment_intent=pi,
            allow_inactive=allow_inactive,
        )

    @staticmethod
    @transaction.atomic
    def reverse_topup_payment_intent(
        *,
        user,
        amount: int,
        description: str = "Topup reversal",
        provider_event=None,
        provider_event_id: str | None = None,
        payment_intent=None,
        payment_intent_id: int | None = None,
        tx_type: str = WalletTransaction.Type.REVERSAL,
        allow_restricted_wallet: bool = False,
    ) -> dict:
        if amount <= 0:
            raise ValidationError("amount must be positive")

        wallet = WalletService._get_wallet_for_update(user=user)
        if not allow_restricted_wallet:
            WalletService._ensure_wallet_is_operable(wallet=wallet)
        wallet.refresh_from_db(fields=["balance", "pending_balance", "is_active", "restriction_reason", "restricted_at"])
        WalletService._assert_wallet_ledger_in_sync(wallet=wallet)
        WalletService._assert_pending_ledger_in_sync(wallet=wallet)

        pe = WalletService._resolve_provider_event(provider_event=provider_event, provider_event_id=provider_event_id)
        pi = WalletService._resolve_payment_intent(payment_intent=payment_intent, payment_intent_id=payment_intent_id)

        if pe is not None and pi is not None:
            existing_pending_total = int(
                abs(
                    PendingWalletTransaction.objects.filter(
                        wallet=wallet,
                        transaction_type=PendingWalletTransaction.Type.REVERSAL_OUT,
                        provider_event=pe,
                        payment_intent=pi,
                    ).aggregate(total=Sum("amount"))["total"]
                    or 0
                )
            )
            existing_available_total = int(
                abs(
                    WalletTransaction.objects.filter(
                        wallet=wallet,
                        transaction_type=tx_type,
                        provider_event=pe,
                        payment_intent=pi,
                    ).aggregate(total=Sum("amount"))["total"]
                    or 0
                )
            )
            existing_total = existing_pending_total + existing_available_total
            if existing_total > 0:
                if int(amount) != existing_total:
                    raise ValidationError("provider event reversal amount mismatch")
                return {
                    "requested_amount": int(amount),
                    "pending_reversed": existing_pending_total,
                    "available_reversed": existing_available_total,
                    "outstanding_exposure": 0,
                    "manual_review_required": False,
                    "wallet_blocked": not bool(wallet.is_active),
                }

        remaining = int(amount)
        pending_reversed = 0
        available_reversed = 0

        pending_portion = min(int(wallet.pending_balance), remaining)
        if pending_portion > 0:
            WalletService._apply_pending(
                wallet=wallet,
                tx_type=PendingWalletTransaction.Type.REVERSAL_OUT,
                amount=-pending_portion,
                description=f"{description} (pending reversal)",
                provider_event=pe,
                payment_intent=pi,
                allow_inactive=allow_restricted_wallet,
            )
            pending_reversed = pending_portion
            remaining -= pending_portion

        available_portion = min(int(wallet.balance), remaining)
        if available_portion > 0:
            WalletService.reverse_available_funds(
                user=user,
                amount=available_portion,
                tx_type=tx_type,
                description=f"{description} (available reversal)",
                provider_event=pe,
                payment_intent=pi,
                allow_inactive=allow_restricted_wallet,
            )
            available_reversed = available_portion
            remaining -= available_portion

        wallet_blocked = False
        if remaining > 0:
            restriction_reason = (
                f"REVERSAL_EXPOSURE payment_intent={getattr(pi, 'pk', None)} remaining={int(remaining)}"
            )[:255]
            WalletService.restrict_wallet(wallet=wallet, reason=restriction_reason)
            wallet_blocked = True

        return {
            "requested_amount": int(amount),
            "pending_reversed": int(pending_reversed),
            "available_reversed": int(available_reversed),
            "outstanding_exposure": int(remaining),
            "manual_review_required": bool(remaining > 0),
            "wallet_blocked": bool(wallet_blocked),
        }
