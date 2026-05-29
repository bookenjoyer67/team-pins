/**
 * map-import.test.js — Cross-map import MIME/filename sanitization tests
 *
 * Covers fixes from commit e84b023:
 *   - Validate and sanitize MIME types in cross-map import
 *   - Validate and sanitize filenames in cross-map import
 *
 * Tests the REGEX and sanitization logic used in map-import.js:64-66
 */

import { describe, it, expect } from "vitest";

// Extracted MIME type validation logic from map-import.js:64
function sanitizeMimeType(type) {
  return /^(image|video|audio)\/[\w+.-]+$/.test(type)
    ? type
    : "application/octet-stream";
}

// Extracted filename validation logic from map-import.js:65
function sanitizeFilename(name) {
  return (name || "file").replace(/[/\\]/g, "_").slice(0, 255);
}

describe("MIME type sanitization", () => {
  // VALID MIME TYPES (must pass through unchanged)
  it("accepts image/png", () => {
    expect(sanitizeMimeType("image/png")).toBe("image/png");
  });

  it("accepts image/jpeg", () => {
    expect(sanitizeMimeType("image/jpeg")).toBe("image/jpeg");
  });

  it("accepts image/gif", () => {
    expect(sanitizeMimeType("image/gif")).toBe("image/gif");
  });

  it("accepts image/webp", () => {
    expect(sanitizeMimeType("image/webp")).toBe("image/webp");
  });

  it("accepts image/svg+xml", () => {
    expect(sanitizeMimeType("image/svg+xml")).toBe("image/svg+xml");
  });

  it("accepts video/mp4", () => {
    expect(sanitizeMimeType("video/mp4")).toBe("video/mp4");
  });

  it("accepts video/webm", () => {
    expect(sanitizeMimeType("video/webm")).toBe("video/webm");
  });

  it("accepts audio/mpeg", () => {
    expect(sanitizeMimeType("audio/mpeg")).toBe("audio/mpeg");
  });

  it("accepts audio/ogg", () => {
    expect(sanitizeMimeType("audio/ogg")).toBe("audio/ogg");
  });

  it("accepts audio/wav", () => {
    expect(sanitizeMimeType("audio/wav")).toBe("audio/wav");
  });

  // UNKNOWN/BENIGN TYPES
  it("defaults to octet-stream for text/plain", () => {
    expect(sanitizeMimeType("text/plain")).toBe("application/octet-stream");
  });

  it("defaults to octet-stream for application/json", () => {
    expect(sanitizeMimeType("application/json")).toBe("application/octet-stream");
  });

  // PATH TRAVERSAL / INJECTION ATTEMPTS
  it("sanitizes path traversal in MIME type", () => {
    expect(sanitizeMimeType("../../etc/passwd")).toBe("application/octet-stream");
  });

  it("sanitizes empty MIME type", () => {
    expect(sanitizeMimeType("")).toBe("application/octet-stream");
  });

  it("sanitizes non-MIME strings", () => {
    expect(sanitizeMimeType("<script>alert(1)</script>")).toBe("application/octet-stream");
  });

  it("sanitizes null/undefined", () => {
    expect(sanitizeMimeType(null)).toBe("application/octet-stream");
    expect(sanitizeMimeType(undefined)).toBe("application/octet-stream");
  });

  it("rejects MIME type with only image/ prefix but shell injection", () => {
    expect(sanitizeMimeType("image/$(rm -rf /)")).toBe("application/octet-stream");
  });

  it("rejects MIME type with backtick injection", () => {
    expect(sanitizeMimeType("image/`id`")).toBe("application/octet-stream");
  });

  // EDGE CASE: valid format but unknown subtype
  it("accepts image/x-unknown-custom", () => {
    expect(sanitizeMimeType("image/x-unknown-custom")).toBe("image/x-unknown-custom");
  });
});

describe("Filename sanitization", () => {
  // NORMAL CASES
  it("preserves normal filenames", () => {
    expect(sanitizeFilename("photo.jpg")).toBe("photo.jpg");
  });

  it("preserves filenames with dots", () => {
    expect(sanitizeFilename("my.photo.v2.png")).toBe("my.photo.v2.png");
  });

  it("defaults to 'file' when no name provided", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename(null)).toBe("file");
    expect(sanitizeFilename(undefined)).toBe("file");
  });

  // PATH TRAVERSAL / INJECTION
  it("replaces forward slashes with underscores", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe(".._.._etc_passwd");
  });

  it("replaces backslashes with underscores", () => {
    expect(sanitizeFilename("..\\..\\Windows\\System32\\evil.exe")).toBe(
      ".._.._Windows_System32_evil.exe"
    );
  });

  it("handles mixed slashes", () => {
    expect(sanitizeFilename("a/b\\c/d")).toBe("a_b_c_d");
  });

  // LENGTH TRUNCATION
  it("truncates to 255 characters", () => {
    const long = "a".repeat(300) + ".jpg";
    expect(sanitizeFilename(long).length).toBe(255);
  });

  it("preserves filenames under 255 chars", () => {
    const name = "a".repeat(200) + ".jpg";
    expect(sanitizeFilename(name)).toBe(name);
  });

  // UNICODE
  it("preserves unicode characters in filenames", () => {
    expect(sanitizeFilename("写真.jpg")).toBe("写真.jpg");
  });

  it("preserves emoji in filenames", () => {
    expect(sanitizeFilename("hello 📸.jpg")).toBe("hello 📸.jpg");
  });
});
