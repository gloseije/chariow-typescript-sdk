export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}
