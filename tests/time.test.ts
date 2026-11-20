import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatRelativeTimestamp } from '../src/lib/time.ts';

describe('formatRelativeTimestamp', () => {
  const now = new Date(2026, 10, 20, 14, 30, 0).getTime(); // Nov 20, 2026 14:30 local

  it('returns "Just now" for messages under 1 minute old', () => {
    const iso = new Date(now - 25_000).toISOString();
    assert.equal(formatRelativeTimestamp(iso, now), 'Just now');
  });

  it('returns minute offsets like "10m ago"', () => {
    const iso = new Date(now - 10 * 60_000).toISOString();
    assert.equal(formatRelativeTimestamp(iso, now), '10m ago');
  });

  it('returns hour offsets like "3h ago" on the same day', () => {
    const iso = new Date(now - 3 * 3_600_000).toISOString();
    assert.equal(formatRelativeTimestamp(iso, now), '3h ago');
  });

  it('returns "Yesterday" for messages from the previous calendar day (>= 6h ago)', () => {
    const yesterday = new Date(2026, 10, 19, 18, 0, 0).toISOString();
    assert.equal(formatRelativeTimestamp(yesterday, now), 'Yesterday');
  });

  it('returns day offsets like "3d ago" within the past week', () => {
    const threeDaysAgo = new Date(2026, 10, 17, 12, 0, 0).toISOString();
    assert.equal(formatRelativeTimestamp(threeDaysAgo, now), '3d ago');
  });

  it('returns formatted month/day for older messages in the same year', () => {
    const olderSameYear = new Date(2026, 9, 5, 12, 0, 0).toISOString();
    const result = formatRelativeTimestamp(olderSameYear, now);
    assert.ok(result.includes('Oct') && result.includes('5'), `Unexpected format: ${result}`);
  });
});
