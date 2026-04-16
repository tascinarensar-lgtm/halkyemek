export function repairPotentialMojibake(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  if (!/[ÃÄÅ]/.test(value)) {
    return value;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(value, (char) => char.charCodeAt(0)));
  } catch {
    return value;
  }
}
