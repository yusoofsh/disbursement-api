export function success<T>(data: T, meta?: Record<string, unknown>) {
  return meta ? { success: true as const, data, meta } : { success: true as const, data };
}

export function failure(code: string, message: string) {
  return { success: false as const, error: { code, message } };
}
