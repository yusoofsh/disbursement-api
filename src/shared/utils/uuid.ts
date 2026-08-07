const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Strict UUID v4 check (version nibble 4, RFC 4122 variant 8/9/a/b). */
export function isUuidV4(value: string): boolean {
  return UUID_V4_RE.test(value);
}
