/**
 * path-shim.test.js — Path resolution security tests
 *
 * Covers fixes from commit e84b023:
 *   - Add proper .. path resolution to path shim (join/resolve)
 *   - Path traversal protection
 */

import { describe, it, expect } from "vitest";
import { join, resolve, dirname, basename, extname, normalize, sep } from "../path-shim.js";

describe("join — path traversal protection", () => {
  // NORMAL CASES
  it("joins simple paths", () => {
    expect(join("a", "b", "c")).toBe("/a/b/c");
  });

  it("joins a single path", () => {
    expect(join("foo")).toBe("/foo");
  });

  it("handles empty input", () => {
    expect(join()).toBe("/");
  });

  // PATH TRAVERSAL CASES (security-critical)
  it("resolves .. components correctly", () => {
    expect(join("a", "b", "..", "c")).toBe("/a/c");
  });

  it("prevents traversing above root with ..", () => {
    expect(join("..", "etc", "passwd")).toBe("/etc/passwd");
  });

  it("handles multiple .. components", () => {
    expect(join("a", "b", "c", "..", "..", "d")).toBe("/a/d");
  });

  it("strips single . components", () => {
    expect(join("a", ".", "b")).toBe("/a/b");
  });

  it("handles mixed . and .. components", () => {
    expect(join("a", ".", "b", "..", ".", "c")).toBe("/a/c");
  });

  it("strips empty string components", () => {
    expect(join("a", "", "b")).toBe("/a/b");
  });

  // COMPLEX TRAVERSAL ATTEMPTS
  it("handles deep traversal that would go above root", () => {
    expect(join("a", "..", "..", "..", "..", "etc")).toBe("/etc");
  });

  it("handles path with embedded traversal in segments", () => {
    expect(join("/a/b", "../c")).toBe("/a/c");
  });

  it("handles root double-dotted path", () => {
    expect(join("/", "..", "..", "foo")).toBe("/foo");
  });
});

describe("resolve", () => {
  it("is equivalent to join", () => {
    expect(resolve("a", "b")).toBe(join("a", "b"));
  });

  it("resolves with .. components", () => {
    expect(resolve("a", "..", "b")).toBe(join("a", "..", "b"));
  });
});

describe("normalize", () => {
  it("returns input unchanged (no-op)", () => {
    expect(normalize("a/b/c")).toBe("a/b/c");
  });
});

describe("dirname", () => {
  it("returns parent directory", () => {
    expect(dirname("a/b/c.txt")).toBe("a/b");
  });

  it("returns / for root file", () => {
    expect(dirname("file.txt")).toBe("/");
  });
});

describe("basename", () => {
  it("returns file name from path", () => {
    expect(basename("a/b/c.txt")).toBe("c.txt");
  });

  it("returns full path if no slashes", () => {
    expect(basename("file.txt")).toBe("file.txt");
  });
});

describe("extname", () => {
  it("returns extension", () => {
    expect(extname("file.txt")).toBe(".txt");
  });

  it("returns empty for no extension", () => {
    expect(extname("file")).toBe("");
  });

  it("returns extension for dotfile (regex matched .gitignore)", () => {
    // .gitignore has no slashes after the dot, so regex /\.[^./]+$/ matches
    expect(extname(".gitignore")).toBe(".gitignore");
  });
});

describe("sep", () => {
  it("is forward slash", () => {
    expect(sep).toBe("/");
  });
});
