import { busOptions, busLabel, shortIdentifier, sortBuses, normalizeRegistration } from './busOptions';

// The nine distinct school buses (N4978 supplied twice, listed once).
const buses = [
  { id: 'b8', vehicle_no: 'MH 40 CT5778', code: 'CT5778', name: 'CT5778' },
  { id: 'b1', vehicle_no: 'MH 40 N426', code: 'N426', name: 'N426' },
  { id: 'b5', vehicle_no: 'MH 40 AT478', code: 'AT478', name: 'AT478' },
  { id: 'b3', vehicle_no: 'MH 40 N4978', code: 'N4978', name: 'N4978' },
  { id: 'b2', vehicle_no: 'MH 40 N1078', code: 'N1078', name: 'N1078' },
  { id: 'b4', vehicle_no: 'MH 40 Y7178', code: 'Y7178', name: 'Y7178' },
  { id: 'b6', vehicle_no: 'MH 40 BG7978', code: 'BG7978', name: 'BG7978' },
  { id: 'b7', vehicle_no: 'MH 40 BL8279', code: 'BL8279', name: 'BL8279' },
  { id: 'b9', vehicle_no: 'MH 40 CT5578', code: 'CT5578', name: 'CT5578' },
];

describe('bus registration normalization', () => {
  test('equivalent spellings compare equal', () => {
    expect(normalizeRegistration('MH 40 N426')).toBe('MH40N426');
    expect(normalizeRegistration('mh-40-n426')).toBe('MH40N426');
  });

  test('short identifier drops the common prefix', () => {
    expect(shortIdentifier('MH 40 N426')).toBe('N426');
    expect(shortIdentifier('N4978')).toBe('N4978');
  });
});

describe('bus ordering and labels', () => {
  test('buses are listed in the school order', () => {
    expect(sortBuses(buses).map(b => shortIdentifier(b.vehicle_no))).toEqual(
      ['N426', 'N1078', 'N4978', 'Y7178', 'AT478', 'BG7978', 'BL8279', 'CT5578', 'CT5778']);
  });

  test('each option shows the short identifier then the full registration', () => {
    expect(busLabel(buses.find(b => b.id === 'b1'))).toBe('N426 — MH 40 N426');
  });

  test('nine unique options, N4978 appears once', () => {
    const opts = busOptions(buses);
    expect(opts).toHaveLength(9);
    expect(opts.filter(o => o.label.startsWith('N4978'))).toHaveLength(1);
    expect(new Set(opts.map(o => o.label)).size).toBe(9);
  });

  test('a bus with no registration falls back to its short identifier', () => {
    expect(busLabel({ code: 'N426' })).toBe('N426');
  });
});
