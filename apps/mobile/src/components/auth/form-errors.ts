import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiRequestError } from '@/lib/api-client';

export function resolveFormError<TFieldValues extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TFieldValues>,
  allowedFields: readonly Path<TFieldValues>[],
): string {
  if (error instanceof ApiRequestError) {
    if (error.fieldErrors) {
      let appliedFieldError = false;
      for (const field of allowedFields) {
        const messages = error.fieldErrors[field];
        const firstMessage = messages?.[0];
        if (firstMessage) {
          setError(field, { type: 'server', message: firstMessage });
          appliedFieldError = true;
        }
      }
      if (appliedFieldError) {
        return '';
      }
    }
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Something went wrong. Please try again.';
}
