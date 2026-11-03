export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function reportDateBounds(range: string, customFrom: string, customTo: string, currentDate = new Date()): [string, string] {
  const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  const end = new Date(start);
  if (range === 'Today') return [formatLocalDate(start), formatLocalDate(end)];
  if (range === 'Yesterday') {
    start.setDate(start.getDate() - 1);
    return [formatLocalDate(start), formatLocalDate(start)];
  }
  if (range === 'This week') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end.setDate(start.getDate() + 6);
    return [formatLocalDate(start), formatLocalDate(end)];
  }
  if (range === 'This month') return [formatLocalDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)), formatLocalDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0))];
  if (range === 'Previous month') return [formatLocalDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1)), formatLocalDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), 0))];
  if (range === 'Last 3 months') return [formatLocalDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 2, 1)), formatLocalDate(end)];
  if (range === 'Last 6 months') return [formatLocalDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 5, 1)), formatLocalDate(end)];
  if (range === 'This year') return [formatLocalDate(new Date(currentDate.getFullYear(), 0, 1)), formatLocalDate(end)];
  if (range === 'Previous year') return [formatLocalDate(new Date(currentDate.getFullYear() - 1, 0, 1)), formatLocalDate(new Date(currentDate.getFullYear() - 1, 11, 31))];
  if (range === 'Custom range') return [customFrom, customTo];
  return ['', ''];
}

export function localDateText(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'Not recorded';
  return value.length === 10 ? value : formatLocalDate(new Date(value));
}

export function localTimestampBoundary(date: string, nextDay = false): string {
  const boundary = new Date(`${date}T00:00:00`);
  if (nextDay) boundary.setDate(boundary.getDate() + 1);
  return boundary.toISOString();
}

export function escapeCsvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
