import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Feature: platform-enhancements
 * Property 1: Date range filter returns only matching files
 *
 * Validates: Requirements 1.3, 1.7, 1.8
 *
 * Pure logic extraction of the date range filtering from
 * app/api/file-explorer/route.ts — filters records by updatedAt
 * using optional dateFrom (gte) and dateTo (lte), both inclusive.
 */

interface FileRecord {
  id: string;
  updatedAt: Date;
}

/**
 * Replicates the date range filtering logic from the File Explorer API.
 * Both boundaries are inclusive. Either param can be omitted.
 */
function filterByDateRange(
  records: FileRecord[],
  dateFrom: Date | null,
  dateTo: Date | null
): FileRecord[] {
  return records.filter((r) => {
    if (dateFrom && r.updatedAt < dateFrom) return false;
    if (dateTo && r.updatedAt > dateTo) return false;
    return true;
  });
}

// Arbitrary: generate a date within a reasonable range (2020–2030)
const dateArb = fc.date({
  min: new Date("2020-01-01T00:00:00Z"),
  max: new Date("2030-12-31T23:59:59Z"),
});

// Arbitrary: generate a file record with a random updatedAt
const fileRecordArb = fc.record({
  id: fc.uuid(),
  updatedAt: dateArb,
});

// Arbitrary: optional date (null or a date)
const optionalDateArb = fc.option(dateArb, { nil: null });

describe("Feature: platform-enhancements, Property 1: Date range filter returns only matching files", () => {
  it("should return exactly the records satisfying the date constraints", () => {
    fc.assert(
      fc.property(
        fc.array(fileRecordArb, { minLength: 0, maxLength: 50 }),
        optionalDateArb,
        optionalDateArb,
        (records, dateFrom, dateTo) => {
          const result = filterByDateRange(records, dateFrom, dateTo);

          // Every returned record must satisfy the constraints
          for (const r of result) {
            if (dateFrom) expect(r.updatedAt >= dateFrom).toBe(true);
            if (dateTo) expect(r.updatedAt <= dateTo).toBe(true);
          }

          // Every record NOT returned must violate at least one constraint
          const resultIds = new Set(result.map((r) => r.id));
          for (const r of records) {
            if (!resultIds.has(r.id)) {
              const satisfiesFrom = !dateFrom || r.updatedAt >= dateFrom;
              const satisfiesTo = !dateTo || r.updatedAt <= dateTo;
              expect(satisfiesFrom && satisfiesTo).toBe(false);
            }
          }

          // Result count must equal the count of matching records
          const expectedCount = records.filter((r) => {
            const okFrom = !dateFrom || r.updatedAt >= dateFrom;
            const okTo = !dateTo || r.updatedAt <= dateTo;
            return okFrom && okTo;
          }).length;
          expect(result.length).toBe(expectedCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should return all records when both dateFrom and dateTo are null", () => {
    fc.assert(
      fc.property(
        fc.array(fileRecordArb, { minLength: 0, maxLength: 30 }),
        (records) => {
          const result = filterByDateRange(records, null, null);
          expect(result.length).toBe(records.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should filter by dateFrom only when dateTo is null (Req 1.7)", () => {
    fc.assert(
      fc.property(
        fc.array(fileRecordArb, { minLength: 1, maxLength: 30 }),
        dateArb,
        (records, dateFrom) => {
          const result = filterByDateRange(records, dateFrom, null);

          for (const r of result) {
            expect(r.updatedAt >= dateFrom).toBe(true);
          }

          const excluded = records.filter(
            (r) => !result.some((res) => res.id === r.id)
          );
          for (const r of excluded) {
            expect(r.updatedAt < dateFrom).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should filter by dateTo only when dateFrom is null (Req 1.8)", () => {
    fc.assert(
      fc.property(
        fc.array(fileRecordArb, { minLength: 1, maxLength: 30 }),
        dateArb,
        (records, dateTo) => {
          const result = filterByDateRange(records, null, dateTo);

          for (const r of result) {
            expect(r.updatedAt <= dateTo).toBe(true);
          }

          const excluded = records.filter(
            (r) => !result.some((res) => res.id === r.id)
          );
          for (const r of excluded) {
            expect(r.updatedAt > dateTo).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
