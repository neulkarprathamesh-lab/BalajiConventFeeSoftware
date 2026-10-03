import { formatAddedOn } from './dateTime';

describe('formatAddedOn', () => {
  test('shows the entry time in India time, 12-hour with AM/PM', () => {
    // 10:12 UTC is 15:42 IST
    expect(formatAddedOn('2026-10-03T10:12:00+00:00')).toBe('03-Oct-2026 03:42 PM');
  });

  test('morning times show AM', () => {
    expect(formatAddedOn('2026-10-03T03:30:00+00:00')).toBe('03-Oct-2026 09:00 AM');
  });

  test('missing timestamp (legacy record) shows a dash, never an invented time', () => {
    expect(formatAddedOn(undefined)).toBe('—');
    expect(formatAddedOn(null)).toBe('—');
    expect(formatAddedOn('')).toBe('—');
  });

  test('unreadable timestamp shows a dash', () => {
    expect(formatAddedOn('not-a-date')).toBe('—');
  });
});
