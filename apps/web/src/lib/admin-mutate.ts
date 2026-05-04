import apiClient, { type ApiSuccessEnvelope, type RequestOptions } from '@/lib/api-client';

type AdminMutationMethod = 'POST' | 'PATCH' | 'DELETE';

const ADMIN_CONFIRM_HEADERS: Record<string, string> = { 'X-Admin-Confirm': 'true' };

export function adminMutate<T = unknown>(
  method: AdminMutationMethod,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<ApiSuccessEnvelope<T>> {
  const merged: RequestOptions = {
    ...options,
    headers: { ...ADMIN_CONFIRM_HEADERS, ...(options?.headers ?? {}) },
  };

  if (method === 'POST') return apiClient.post<T>(path, body, merged);
  if (method === 'PATCH') return apiClient.patch<T>(path, body, merged);
  return apiClient.delete<T>(path, merged);
}
