const TRANSACTION_LABELS: Record<string, string> = {
  TOP_UP: "Bakiye yükleme",
  TOPUP: "Bakiye yükleme",
  TOPUP_PENDING: "Bekleyen bakiye yükleme",
  PURCHASE: "Sipariş ödemesi",
  ORDER_PAYMENT: "Sipariş ödemesi",
  REFUND: "İade",
  ORDER_REFUND: "Sipariş iadesi",
  PAYMENT_REVERSAL: "Ödeme düzeltmesi",
  REVERSAL: "Ters kayıt",
  REVERSAL_OUT: "Bekleyen ters kayıt",
  ADJUSTMENT: "Manuel düzeltme",
  SETTLEMENT: "Mutabakat işlemi",
  SETTLEMENT_OUT: "Bekleyen mutabakat işlemi",
  CHARGEBACK: "Ters ibraz",
};

export function getWalletTransactionLabel(type: string) {
  return TRANSACTION_LABELS[String(type || "").trim().toUpperCase()] || type || "Bilinmeyen işlem";
}

export function getPendingWalletTransactionEffect(amount: number) {
  if (amount > 0) {
    return "Bekleyen bakiyeyi artırır";
  }

  if (amount < 0) {
    return "Bekleyen bakiyeyi azaltır";
  }

  return "Bekleyen bakiyeyi etkilemez";
}

export function getPendingWalletTransactionDescription(type: string, description: string) {
  const normalizedType = String(type || "").trim().toUpperCase();
  const normalizedDescription = String(description || "").trim();
  const lowerDescription = normalizedDescription.toLowerCase();

  if (!normalizedDescription) {
    if (normalizedType === "TOPUP_PENDING") {
      return "Ödeme alındıktan sonra cüzdana yansıması beklenen yükleme kaydı burada görünür.";
    }
    if (normalizedType === "SETTLEMENT_OUT") {
      return "Bekleyen tutarın cüzdana aktarılması için ayrılan hareket burada görünür.";
    }
    if (normalizedType === "REVERSAL_OUT") {
      return "Bekleyen tutar üzerinde yapılan geri alma veya düzeltme kaydı burada görünür.";
    }
    return "Bu hareket bekleyen bakiyeyi etkileyen geçici bir cüzdan kaydıdır.";
  }

  if (lowerDescription.includes("topup paid") && lowerDescription.includes("pending")) {
    return "Ödeme alındı; tutar cüzdana aktarılmadan önce bekleyen bakiye alanında izleniyor.";
  }

  if (lowerDescription.includes("pending -> available")) {
    return "Bekleyen tutar onaylanarak kullanılabilir cüzdana aktarılma sürecine girdi.";
  }

  if (lowerDescription.includes("pending reversal")) {
    return "Bekleyen tutar üzerinde geri alma veya düzeltme işlemi uygulandı.";
  }

  if (lowerDescription.includes("available reversal")) {
    return "Kullanılabilir cüzdandaki ilgili tutar için geri alma işlemi uygulandı.";
  }

  if (normalizedType === "TOPUP_PENDING") {
    return "Ödeme alındı; bu tutar cüzdana tamamen yansıyıncaya kadar bekleyen bakiye olarak görünür.";
  }

  if (normalizedType === "SETTLEMENT_OUT") {
    return "Bu hareket, bekleyen bakiyedeki tutarın cüzdana aktarılma adımını temsil eder.";
  }

  if (normalizedType === "REVERSAL_OUT") {
    return "Bu hareket, bekleyen bakiyede yapılan iade veya düzeltme sürecini temsil eder.";
  }

  return normalizedDescription;
}
