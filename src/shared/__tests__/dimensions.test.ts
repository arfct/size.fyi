import { describe, expect, test } from 'vitest';
import { formatDims, formatLength, parseDimensions, pickUnit, pickUnitFor } from '../dimensions';

describe('parseDimensions', () => {
  test('bare numbers default to mm', () =>
    expect(parseDimensions('85x64x12')).toEqual({ h: 85, w: 64, d: 12 }));
  test('mm suffix', () => expect(parseDimensions('85x64x12mm')).toEqual({ h: 85, w: 64, d: 12 }));
  test('inches convert', () =>
    expect(parseDimensions('5x3x2in')).toEqual({ h: 127, w: 76.2, d: 50.8 }));
  test('cm converts', () =>
    expect(parseDimensions('29.7x21x0.1cm')).toEqual({ h: 297, w: 210, d: 1 }));
  test('m and ft convert', () => {
    expect(parseDimensions('2x1x0.5m')).toEqual({ h: 2000, w: 1000, d: 500 });
    expect(parseDimensions('6x3x1ft')).toEqual({ h: 1828.8, w: 914.4, d: 304.8 });
  });
  test('spaces, ×, and case tolerated', () =>
    expect(parseDimensions(' 85 × 64 X 12 MM ')).toEqual({ h: 85, w: 64, d: 12 }));
  test('rejects garbage', () => {
    expect(parseDimensions('')).toBeNull();
    expect(parseDimensions('85x64')).toBeNull(); // 3 dims required
    expect(parseDimensions('85x64x12x9')).toBeNull();
    expect(parseDimensions('axbxc')).toBeNull();
    expect(parseDimensions('85x64x12km')).toBeNull(); // unsupported unit
    expect(parseDimensions('0x10x10')).toBeNull(); // below 0.1mm floor
    expect(parseDimensions('-5x3x2')).toBeNull();
    expect(parseDimensions('200000x1x1')).toBeNull(); // above 100m ceiling
  });
});

describe('formatting', () => {
  test('metric mm', () => expect(formatLength(85, 'metric')).toBe('85 mm'));
  test('metric rounds to 1dp', () => expect(formatLength(8.25, 'metric')).toBe('8.3 mm'));
  test('metric switches to m at 1000', () => expect(formatLength(1905, 'metric')).toBe('1.91 m'));
  test('imperial inches', () => expect(formatLength(85, 'imperial')).toBe('3.3 in'));
  test('imperial switches to decimal feet at 3 ft', () =>
    expect(formatLength(1905, 'imperial')).toBe('6.3 ft'));
  test('formatDims joins h×w×d', () =>
    expect(formatDims({ h: 297, w: 210, d: 1 }, 'metric')).toBe('297 × 210 × 1 mm'));
  test('formatDims shows the unit once (imperial, all inches)', () =>
    expect(formatDims({ h: 150, w: 71.9, d: 8.8 }, 'imperial')).toBe('5.9 × 2.8 × 0.3 in'));
  test('formatDims never mixes units — the smallest side picks mm', () =>
    expect(formatDims({ h: 1982, w: 838, d: 33 }, 'metric')).toBe('1982 × 838 × 33 mm'));
  test('formatDims never mixes units — the smallest side picks in', () =>
    expect(formatDims({ h: 1905, w: 300, d: 100 }, 'imperial')).toBe('75.0 × 11.8 × 3.9 in'));
  test('formatDims uses m only when every side is at least 1 m', () =>
    expect(formatDims({ h: 2000, w: 1500, d: 1000 }, 'metric')).toBe('2.00 × 1.50 × 1.00 m'));
  test('formatDims honours a shared unit passed in', () =>
    expect(formatDims({ h: 2000, w: 1500, d: 1000 }, 'metric', 'mm')).toBe(
      '2000 × 1500 × 1000 mm',
    ));
});

describe('pickUnit', () => {
  test('smallest length decides (metric)', () => {
    expect(pickUnit([1414, 1000, 1], 'metric')).toBe('mm');
    expect(pickUnit([1414, 1000, 1000], 'metric')).toBe('m');
  });
  test('smallest length decides (imperial)', () => {
    expect(pickUnit([1905, 914], 'imperial')).toBe('in');
    expect(pickUnit([1905, 914.4], 'imperial')).toBe('ft');
  });
  test('pickUnitFor spans every axis of every item', () =>
    expect(
      pickUnitFor(
        [
          { h: 2000, w: 2000, d: 2000 },
          { h: 1500, w: 1200, d: 900 },
        ],
        'metric',
      ),
    ).toBe('mm'));
});
