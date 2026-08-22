import { describe, expect, it } from 'vitest';

import { compareValues } from '@/lib/sorting';

describe('sorting utilities', () => {
  describe('compareValues', () => {
    it('sorts numeric values correctly', () => {
      expect(compareValues(15, 100, 'number', 'asc')).toBeLessThan(0);
      expect(compareValues(100, 15, 'number', 'asc')).toBeGreaterThan(0);
      expect(compareValues(15, 100, 'number', 'desc')).toBeGreaterThan(0);
      expect(compareValues(8, 2, 'number', 'asc')).toBeGreaterThan(0);

      // String formatted numbers shouldn't be handled by compareValues directly if we use raw values,
      // but if they are passed as raw numbers, they sort correctly.
      expect(compareValues('1000', '15', 'number', 'asc')).toBeGreaterThan(0);
    });

    it('sorts text correctly', () => {
      expect(compareValues('Adelaide', 'Brisbane Lions', 'text', 'asc')).toBeLessThan(0);
      expect(compareValues('Zebra', 'Apple', 'text', 'asc')).toBeGreaterThan(0);
      expect(compareValues('Zebra', 'Apple', 'text', 'desc')).toBeLessThan(0);
    });

    it('sorts dates correctly', () => {
      expect(compareValues('2023-01-01', '2024-01-01', 'date', 'asc')).toBeLessThan(0);
      expect(compareValues('2024-01-01', '2023-01-01', 'date', 'desc')).toBeLessThan(0);
    });

    it('handles null and undefined values correctly', () => {
      // Nulls should always be at the bottom (greater than other values in both asc and desc)
      expect(compareValues(null, 100, 'number', 'asc')).toBeGreaterThan(0);
      expect(compareValues(100, null, 'number', 'asc')).toBeLessThan(0);
      expect(compareValues(null, 100, 'number', 'desc')).toBeGreaterThan(0); // Still at bottom
      expect(compareValues(undefined, 'Apple', 'text', 'asc')).toBeGreaterThan(0);
      expect(compareValues(undefined, undefined, 'text', 'asc')).toBe(0);
      expect(compareValues(null, undefined, 'number', 'desc')).toBe(0);
    });
  });
});
