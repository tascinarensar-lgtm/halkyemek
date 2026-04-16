import type { ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { describeApiError } from "@/lib/api/presentation";

type QueryStateProps<T> = {
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  data: T | null | undefined;
  loadingFallback?: ReactNode;
  errorTitle?: string;
  errorDescription?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
};

export function QueryState<T>({
  isPending,
  isError,
  error,
  data,
  loadingFallback,
  errorTitle = "Veri yüklenemedi",
  errorDescription,
  emptyTitle,
  emptyDescription,
  isEmpty,
  children,
}: QueryStateProps<T>) {
  if (isPending) {
    return loadingFallback ?? <LoadingSkeleton />;
  }

  if (isError) {
    return <ErrorState title={errorTitle} description={errorDescription ?? describeApiError(error)} />;
  }

  if (data == null || (isEmpty ? isEmpty(data) : false)) {
    if (emptyTitle && emptyDescription) {
      return <EmptyState title={emptyTitle} description={emptyDescription} />;
    }
    return null;
  }

  return <>{children(data)}</>;
}
