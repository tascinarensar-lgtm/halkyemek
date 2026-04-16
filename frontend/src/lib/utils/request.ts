export function createRequestId() {
  return crypto.randomUUID().replace(/-/g, "");
}

export function createIdempotencyKey(prefix = "hy") {
  return `${prefix}-${crypto.randomUUID()}`;
}
