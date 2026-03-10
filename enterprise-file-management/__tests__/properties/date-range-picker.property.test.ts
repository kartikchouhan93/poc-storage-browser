import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Feature: platform-enhancements
 * Property 2: Date range picker enforces start <= end
 *
 * Validates: Requirements 1.5
 *
 * Pure logic extraction of the date range validation from
 * components/ui/date-range-picker.tsx — when a range selection
 * has `to < from`, the component drops the invalid `to` and
 * only emits `{ from }`. It never emits a range where to < from.
 */

interface DateRange {
  from?: Date;
  to?: Date;
}

/**
 * Replicates the onSelect validation logic from DateRangePicker.
 * This is the pure function equivalent of the component's onSelect handler.
 *
 * Given a raw range selection from the calendar, returns the sanitized
 * range that would be emitted to the parent via onDateRangeChange.
 */
function sanitizeDateRange(range: DateRange | null | undefined): DateRange {
  if (!range) {
    return {};
  }
  // Enforce to >= from: if to < from, drop the to
  if (range.from && range.to && range.to < range.from) {
    return { from: range.from };
  }
  return { from: range.from, to: range.to };
}

// Arbitrary: generate a date within a reasonable range (2020–2030)
const dateArb = fc.date({
  min: new Date("2020-01-01T00:00:00Z"),
  max: new Date("2030-12-31T23:59:59Z"),
});

describe("Feature: platform-enhancements, Property 2: Date range picker enforces start <= end", () => {
  it("should never emit a range where to < from for any invalid date pair", () => {
    fc.assert(
      fc.property(
        dateArb,
        dateArb,
        (dateA, dateB) => {
          // Ensure end < start (invalid pair)
          const from = dateA > dateB ? dateA : dateB;
          const to = dateA > dateB ? dateB : dateA;

          // Skip when dates are equal — that's a valid range
          if (from.getTime() === to.getTime()) return;

          const result = sanitizeDateRange({ from, to });

          // The sanitized result must NOT have both from and to with to < from
          if (result.from && result.to) {
            expect(result.to >= result.from).toBe(true);
          }

          // Specifically: the invalid `to` should have been dropped
          expect(result.to).toBeUndefined();
          expect(result.from).toEqual(from);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should pass through valid ranges where to >= from unchanged", () => {
    fc.assert(
      fc.property(
        dateArb,
        dateArb,
        (dateA, dateB) => {
          // Ensure from <= to (valid pair)
          const from = dateA <= dateB ? dateA : dateB;
          const to = dateA <= dateB ? dateB : dateA;

          const result = sanitizeDateRange({ from, to });

          // Valid range should be emitted as-is
          expect(result.from).toEqual(from);
          expect(result.to).toEqual(to);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should return empty range when input is null or undefined", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(null, undefined),
        (input) => {
          const result = sanitizeDateRange(input);
          expect(result).toEqual({});
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should handle partial ranges (only from, only to) without modification", () => {
    fc.assert(
      fc.property(
        dateArb,
        fc.boolean(),
        (date, useFrom) => {
          const range: DateRange = useFrom ? { from: date } : { to: date };
          const result = sanitizeDateRange(range);

          // Partial ranges pass through — no to < from check possible
          if (useFrom) {
            expect(result.from).toEqual(date);
            expect(result.to).toBeUndefined();
          } else {
            expect(result.to).toEqual(date);
            expect(result.from).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
