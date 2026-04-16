export type FieldErrorMessage = string | string[] | Record<string, unknown>;

export interface ApiErrorEnvelope {
  ok?: false;
  error: {
    code: string;
    message: FieldErrorMessage;
    request_id?: string;
    reason?: string;
    details?: Record<string, unknown>;
  };
}

export interface ApiSuccessEnvelope<T> {
  ok?: true;
  data?: T;
}
