import { ApiClientError, getApiErrorMessage, getApiRequestId } from "@/lib/api/errors";

export function describeApiError(error: unknown, fallback = "İşlem tamamlanamadı.", options?: { includeRequestId?: boolean }) {
  const message = getApiErrorMessage(error, fallback);
  const requestId = options?.includeRequestId ? getApiRequestId(error) : undefined;
  return requestId ? `${message} · request_id: ${requestId}` : message;
}

export function isApiStatus(error: unknown, status: number) {
  return error instanceof ApiClientError && error.status === status;
}

export function isNotFoundError(error: unknown) {
  return isApiStatus(error, 404);
}

export function isGoneError(error: unknown) {
  return isApiStatus(error, 410);
}

export function isConflictError(error: unknown) {
  return isApiStatus(error, 409);
}
