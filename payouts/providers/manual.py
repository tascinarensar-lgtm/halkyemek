from __future__ import annotations
# Bu aşamada gerçek banka/iyzico payout API’si yok; ama motoru test edebilmek için “manual provider” ekliyoruz.

import os
import secrets
from dataclasses import dataclass
from typing import Any

@dataclass(frozen=True)
class DispatchResult:
    ok: bool
    provider_payout_id: str = ""
    error_code: str = ""
    error_message: str = ""
    retryable: bool = True
    raw: dict[str, Any] | None = None

class ManualPayoutProvider:
    """
    Payout motorun (state machine, retry, ledger güncelleme vs.) gerçek banka entegrasyonuna bağımlı olmasın.
    Gerçek banka API’si gelmeden önce tüm ödeme akışını test edebilesin.
    İleride iyzico, banka EFT, ERP, marketplace settlement gibi farklı sağlayıcıları adapter pattern ile tak-çıkar şekilde ekleyebilesin.
    """
    name = "manual" # Provider İsmi

    def dispatch(self, *, payout_id: int, amount: int, currency: str, business_id: int) -> DispatchResult: # Gerçek dünyada “işletmeye para gönderme” işlemini temsil eder. DispatchResult classını dönecek
        # FAIL simülasyonu
        if os.environ.get("PAYOUT_SIMULATE_FAIL", "") == "1": # Eğer sistemde: PAYOUT_SIMULATE_FAIL=1 ise provider bilinçsiz bir şekilde fail olacak yani -> eğer sonuç  failse ;
            return DispatchResult(
                ok=False,
                error_code="SIM_FAIL",
                error_message="Simulated provider failure",
                retryable=True,
                raw={"provider": self.name, "simulated": "fail"},
            ) # bu sonuç dönülecek
        # fail değilse ;
        provider_payout_id = f"MANUAL-{payout_id}-{secrets.token_hex(4)}"
        return DispatchResult(
            ok=True,
            provider_payout_id=provider_payout_id,
            raw={"provider": self.name, "provider_payout_id": provider_payout_id},
        )
