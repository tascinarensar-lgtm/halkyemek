from django.contrib import admin
from .models import Wallet, WalletTransaction


@admin.register(WalletTransaction)
class WalletTransactionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "wallet",
        "transaction_type",
        "amount",
        "before_balance",
        "after_balance",
        "order",
        "created_at",
    )
    list_filter = ("transaction_type",)
    search_fields = ("wallet__user__username", "order__id")
    readonly_fields = (
        "wallet",
        "transaction_type",
        "amount",
        "before_balance",
        "after_balance",
        "order",
        "description",
        "created_at",
    )

    def has_add_permission(self, request): #ekle butonunu kapattık
        return False

    def has_change_permission(self, request, obj=None): #düzenleme butonunu kapattık. bu methodda işin içine seçme vs girdiği için bu methodalrda obj olur genelde.
        return False

    def has_delete_permission(self, request, obj=None): #silme butonunu kapattık bu methodda işin içine seçme vs girdiği için bu methodalrda obj olur genelde.
        return False

    def get_actions(self, request): #toplu işlemlere girip toplu silme butonunu kapattık
        actions = super().get_actions(request) #varsayılan işlemleri aldık
        actions.pop("delete_selected", None) #pop silme çıkartma işlemidir. ilk parametre silmenin ismi ikinci none ise yazılmalı kuraldır.(delete_selected yoksa hata fırlatmasın none döndün diye)
        return actions
