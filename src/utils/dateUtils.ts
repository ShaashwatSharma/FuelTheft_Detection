// src/utils/dateUtils.ts
export function parseDate(input: unknown, fallback: Date): Date {
  if (!input) return fallback;
  const d = new Date(String(input));
  return isNaN(d.getTime()) ? fallback : d;
}

export function normalizeRange(fromRaw: unknown, toRaw: unknown): { from: Date; to: Date } {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 7 * 24 * 3600 * 1000); // last 7 days
  const from = parseDate(fromRaw, defaultFrom);
  const to = parseDate(toRaw, now);
  return from > to ? { from: to, to: from } : { from, to };
}

export function validateDateRange(fromDate: unknown, toDate: unknown): {
  isValid: boolean;
  from?: Date;
  to?: Date;
  error?: string;
} {
  try {
    const from = fromDate ? new Date(fromDate.toString()) : new Date('2000-01-01');
    const to = toDate ? new Date(toDate.toString()) : new Date();

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return { isValid: false, error: 'Invalid date format' };
    }
    if (from > to) {
      return { isValid: false, error: 'fromDate cannot be after toDate' };
    }
    return { isValid: true, from, to };
  } catch {
    return { isValid: false, error: 'Invalid date parsing' };
  }
}
