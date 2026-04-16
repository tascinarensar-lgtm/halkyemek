from __future__ import annotations

"""
Bu fonksiyon marketplace ödeme modelinde 
paranın nasıl bölüneceğini hesaplayan finansal çekirdek fonksiyonudur.
Senin HalkYemek projesinde bu fonksiyon, 
müşteriden çekilen para → platform komisyonu → işletmeye giden pay dağılımını hesaplar.
"""
def calculate_split(*, gross_amount: int, commission_bps: int) -> dict:
    """
    gross_amount: kuruş
    commission_bps: basis points (örn 1000 = %10)
    """
    if gross_amount <= 0:
        raise ValueError("gross_amount must be positive")
    if commission_bps < 0 or commission_bps > 10000:
        raise ValueError("commission_bps must be between 0 and 10000")

    platform_fee = (gross_amount * commission_bps) // 10000
    submerchant_price = gross_amount - platform_fee

    if submerchant_price < 0:
        raise ValueError("submerchant_price cannot be negative")

    return {
        "gross_price": gross_amount,
        "platform_fee": platform_fee,
        "submerchant_price": submerchant_price,
    }