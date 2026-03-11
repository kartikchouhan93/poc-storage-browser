import { describe, it, expect, beforeEach } from "vitest";

const STORAGE_KEY = "userPreferences";

const defaultPreferences = {
  themeMode: "light",
  themeColor: "blue",
  themeFont: "inter",
  themeRadius: "0.3",
};

function readPreferences() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...defaultPreferences };
    const parsed = JSON.parse(stored);
    return {
      themeMode: parsed.themeMode || defaultPreferences.themeMode,
      themeColor: parsed.themeColor || defaultPreferences.themeColor,
      themeFont: parsed.themeFont || defaultPreferences.themeFont,
      themeRadius: parsed.themeRadius || defaultPreferences.themeRadius,
    };
  } catch {
    return { ...defaultPreferences };
  }
}

function writePreferences(prefs: Partial<typeof defaultPreferences>) {
  const current = readPreferences();
  const merged = { ...current, ...prefs };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

beforeEach(() => localStorage.removeItem(STORAGE_KEY));

describe("theme preferences defaults", () => {
  it("returns default values when localStorage is empty", () => {
    expect(readPreferences()).toEqual(defaultPreferences);
  });

  it("default themeMode is light", () => {
    expect(readPreferences().themeMode).toBe("light");
  });

  it("default themeColor is blue", () => {
    expect(readPreferences().themeColor).toBe("blue");
  });

  it("default themeFont is inter", () => {
    expect(readPreferences().themeFont).toBe("inter");
  });

  it("default themeRadius is 0.3", () => {
    expect(readPreferences().themeRadius).toBe("0.3");
  });
});

describe("reading stored preferences", () => {
  it("reads back what was written", () => {
    const prefs = { themeMode: "dark", themeColor: "green", themeFont: "mono", themeRadius: "0.5" };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    expect(readPreferences()).toEqual(prefs);
  });

  it("falls back to defaults for missing keys in stored object", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ themeMode: "dark" }));
    const result = readPreferences();
    expect(result.themeMode).toBe("dark");
    expect(result.themeColor).toBe("blue");
    expect(result.themeFont).toBe("inter");
    expect(result.themeRadius).toBe("0.3");
  });
});

describe("writing preferences", () => {
  it("persists preferences to localStorage", () => {
    writePreferences({ themeMode: "dark" });
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.themeMode).toBe("dark");
  });

  it("partial update merges with existing values", () => {
    writePreferences({ themeMode: "dark", themeColor: "red" });
    const result = writePreferences({ themeFont: "mono" });
    expect(result).toEqual({ themeMode: "dark", themeColor: "red", themeFont: "mono", themeRadius: "0.3" });
  });

  it("round-trip: write then read returns same values", () => {
    const prefs = { themeMode: "dark", themeColor: "purple", themeFont: "sans", themeRadius: "1.0" };
    writePreferences(prefs);
    expect(readPreferences()).toEqual(prefs);
  });
});
