function normalizeAmount(amount: number | null | undefined) {
  return typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
}

function normalizeCurrency(currency?: string) {
  const normalized = String(currency || "TRY").trim().toUpperCase();
  return normalized || "TRY";
}

export function formatCurrency(amount: number | null | undefined, currency = "TRY") {
  const normalizedAmount = normalizeAmount(amount);
  const normalizedCurrency = normalizeCurrency(currency);

  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(normalizedAmount);
  } catch {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 2,
    }).format(normalizedAmount);
  }
}

export function titleFromSlug(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatCount(value: number | null | undefined, singular: string, plural = singular) {
  const normalized = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return `${normalized} ${normalized === 1 ? singular : plural}`;
}
