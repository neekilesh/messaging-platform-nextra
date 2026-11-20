export function formatRelativeTimestamp(isoDate: string, nowMs: number = Date.now()): string {
  const ts = Date.parse(isoDate);
  if (!Number.isFinite(ts)) return '';

  const diffMs = Math.max(0, nowMs - ts);
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);

  const msgDate = new Date(ts);
  const nowDate = new Date(nowMs);
  const startOfMsgDay = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate()).getTime();
  const startOfNowDay = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  const calendarDaysDiff = Math.round((startOfNowDay - startOfMsgDay) / 86_400_000);

  if (calendarDaysDiff === 0 || diffHours < 6) {
    return `${diffHours}h ago`;
  }

  if (calendarDaysDiff === 1) {
    return 'Yesterday';
  }

  if (calendarDaysDiff < 7) {
    return `${calendarDaysDiff}d ago`;
  }

  if (msgDate.getFullYear() === nowDate.getFullYear()) {
    return msgDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  return msgDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatFullTimestamp(isoDate: string): string {
  const ts = Date.parse(isoDate);
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
