/**
 * helpers.test.js — Security hardening tests for validateHex, color validation
 *
 * Covers fixes from commit 369dd93:
 *   - Validate hex color before rendering pin SVG icons
 */

import { describe, it, expect } from "vitest";
import { validateHex, COLORS, colorPresetsHTML } from "../helpers.js";

describe("validateHex", () => {
  // STANDARD CASES (must pass)
  it("accepts valid 6-char lowercase hex with #", () => {
    expect(validateHex("#2563eb")).toBe("#2563eb");
  });

  it("accepts valid 6-char uppercase hex with #", () => {
    expect(validateHex("#EF4444")).toBe("#ef4444");
  });

  it("accepts valid 6-char hex without #", () => {
    expect(validateHex("16a34a")).toBe("#16a34a");
  });

  it("accepts mixed-case hex", () => {
    expect(validateHex("#Ff00Ab")).toBe("#ff00ab");
  });

  it("trims whitespace", () => {
    expect(validateHex("  #ffffff  ")).toBe("#ffffff");
  });

  // SECURITY-RELEVANT EDGE CASES
  it("rejects empty string", () => {
    expect(validateHex("")).toBeNull();
  });

  it("rejects only # with no value", () => {
    expect(validateHex("#")).toBeNull();
  });

  it("rejects 3-char hex (short)", () => {
    expect(validateHex("#fff")).toBeNull();
  });

  it("rejects 7-char hex (too long)", () => {
    expect(validateHex("#1234567")).toBeNull();
  });

  it("rejects hex with invalid characters", () => {
    expect(validateHex("#12g456")).toBeNull();
  });

  it("rejects non-hex garbage", () => {
    expect(validateHex("notacolor")).toBeNull();
  });

  // XSS / INJECTION ATTEMPTS
  it('rejects malicious script tag as color', () => {
    expect(validateHex('<script>alert("xss")</script>')).toBeNull();
  });

  it('rejects "none" (CSS keyword injection)', () => {
    expect(validateHex("none")).toBeNull();
  });

  it("rejects CSS url() injection", () => {
    expect(validateHex("url(javascript:alert(1))")).toBeNull();
  });

  it("rejects expression() injection", () => {
    expect(validateHex("expression(alert(1))")).toBeNull();
  });

  it("rejects color with extra # symbols", () => {
    expect(validateHex("##ff0000")).toBeNull();
  });

  it("rejects newline characters within color (mid-injection attempt)", () => {
    expect(validateHex("#ff\n0000")).toBeNull();
  });

  it("trims trailing newlines then validates (safe)", () => {
    expect(validateHex("#ff0000\n")).toBe("#ff0000");
  });

  // ALL PRESET COLORS MUST VALIDATE
  it.each(COLORS)("preset color %s must be valid", (c) => {
    expect(validateHex(c)).not.toBeNull();
    expect(validateHex(c).toLowerCase()).toBe(c.toLowerCase());
  });

  // BOUNDARY CASES
  it("accepts #000000 (black)", () => {
    expect(validateHex("#000000")).toBe("#000000");
  });

  it("accepts #ffffff (white)", () => {
    expect(validateHex("#ffffff")).toBe("#ffffff");
  });

  it("accepts #FFFFFF (uppercase white)", () => {
    expect(validateHex("#FFFFFF")).toBe("#ffffff");
  });
});

describe("COLORS constant", () => {
  it("has exactly 8 preset colors", () => {
    expect(COLORS).toHaveLength(8);
  });

  it("all presets are valid hex colors", () => {
    for (const c of COLORS) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("colorPresetsHTML", () => {
  it("generates HTML spans with data-color attributes", () => {
    const html = colorPresetsHTML(COLORS, "#2563eb");
    expect(html).toContain('data-color="#ef4444"');
    expect(html).toContain('data-color="#2563eb"');
  });

  it("highlights the selected color with a border", () => {
    const html = colorPresetsHTML(COLORS, "#ef4444");
    const matches = html.match(/border:2px solid #111/g);
    expect(matches).not.toBeNull();
    // Only the selected color gets the border
    expect(matches.length).toBe(1);
  });

  it("returns empty string for empty array", () => {
    expect(colorPresetsHTML([], "#000000")).toBe("");
  });
});
