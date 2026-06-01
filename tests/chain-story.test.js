/**
 * chain-story.test.js — Story mode card rendering tests
 *
 * Phase 3: Story Mode
 * Tests the pure card HTML generation logic used by the story viewer
 * (no DOM, no Leaflet, no IndexedDB needed).
 */

import { describe, it, expect } from "vitest";

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderStoryCard(opts) {
  const { index, total, narrative, pinTitle, pinNote, tags, mediaHtml } = opts;
  const tagLine = tags && tags.length ? ` · ${escapeHtml(tags.join(", "))}` : "";
  const narrativeBlock = narrative
    ? `<div style="font-size:14px;line-height:1.5;margin-bottom:10px;white-space:pre-wrap;">${escapeHtml(narrative)}</div>`
    : "";
  const hasSecondary = pinTitle || pinNote || mediaHtml;
  return `<div style="padding:4px 0;">
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">
      Stop ${index + 1} of ${total}${tagLine}
    </div>
    ${narrativeBlock}
    ${hasSecondary ? `<div style="border-top:1px solid var(--border-light);padding-top:8px;margin-top:8px;">
      ${pinTitle ? `<div style="font-size:12px;font-weight:600;">📌 ${escapeHtml(pinTitle)}</div>` : ""}
      ${pinNote ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px;">${escapeHtml(pinNote)}</div>` : ""}
      ${mediaHtml || ""}
    </div>` : ""}
  </div>`;
}

describe("Story Mode: card rendering", () => {
  it("renders waypoint number and total", () => {
    const html = renderStoryCard({
      index: 2, total: 7,
      narrative: "The journey continues",
      pinTitle: "Market Square",
    });
    expect(html).toContain("Stop 3 of 7");
  });

  it("renders narrative text prominently", () => {
    const html = renderStoryCard({
      index: 0, total: 3,
      narrative: "This is where it all began.",
      pinTitle: "Origin Point",
    });
    expect(html).toContain("This is where it all began.");
    expect(html.indexOf("This is where it all began."))
      .toBeLessThan(html.indexOf("📌 Origin Point"));
  });

  it("renders pin title and note as secondary content", () => {
    const html = renderStoryCard({
      index: 1, total: 5,
      narrative: "The middle chapter",
      pinTitle: "Town Hall",
      pinNote: "Built in 1892",
    });
    expect(html).toContain("📌 Town Hall");
    expect(html).toContain("Built in 1892");
    expect(html).toContain("border-top:1px solid");
  });

  it("renders tags when provided", () => {
    const html = renderStoryCard({
      index: 0, total: 3,
      narrative: "Start here",
      pinTitle: "Gate",
      tags: ["history", "walking-tour"],
    });
    expect(html).toContain("history, walking-tour");
  });

  it("omits tag line when tags is empty", () => {
    const html = renderStoryCard({
      index: 0, total: 3,
      narrative: "Start",
      pinTitle: "Gate",
      tags: [],
    });
    expect(html).not.toContain(" · ");
  });

  it("omits tag line when tags is null", () => {
    const html = renderStoryCard({
      index: 0, total: 3,
      narrative: "Start",
      pinTitle: "Gate",
      tags: null,
    });
    expect(html).not.toContain(" · ");
  });

  it("renders without narrative when empty", () => {
    const html = renderStoryCard({
      index: 0, total: 2,
      narrative: "",
      pinTitle: "Only Info",
      pinNote: "Some note",
    });
    expect(html).not.toContain("font-size:14px;line-height:1.5;margin-bottom:10px");
    expect(html).toContain("📌 Only Info");
  });

  it("renders media html when provided", () => {
    const media = '<img src="photo.jpg" style="max-width:100%;">';
    const html = renderStoryCard({
      index: 0, total: 2,
      narrative: "Look at this",
      pinTitle: "Photo Spot",
      mediaHtml: media,
    });
    expect(html).toContain('src="photo.jpg"');
  });

  it("escapes HTML in narrative text", () => {
    const html = renderStoryCard({
      index: 0, total: 2,
      narrative: "<script>alert('xss')</script>",
      pinTitle: "Safe",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML in pin title", () => {
    const html = renderStoryCard({
      index: 0, total: 2,
      narrative: "Story",
      pinTitle: "<b>Bold</b>",
    });
    expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt;");
    expect(html).not.toContain("<b>Bold</b>");
  });

  it("escapes HTML in pin note", () => {
    const html = renderStoryCard({
      index: 0, total: 2,
      narrative: "Story",
      pinTitle: "Title",
      pinNote: "<img src=x onerror=alert(1)>",
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes HTML in tags", () => {
    const html = renderStoryCard({
      index: 0, total: 2,
      narrative: "Story",
      pinTitle: "Title",
      tags: ['<script>alert("x")</script>'],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders first stop as 'Stop 1'", () => {
    const html = renderStoryCard({
      index: 0, total: 5,
      narrative: "Beginning",
      pinTitle: "Start",
    });
    expect(html).toContain("Stop 1 of 5");
  });

  it("omits secondary section when no pin title, note, or media", () => {
    const html = renderStoryCard({
      index: 0, total: 2,
      narrative: "Just a story",
      pinTitle: "",
      pinNote: "",
      mediaHtml: "",
    });
    expect(html).not.toContain("border-top:1px solid var(--border-light)");
    expect(html).not.toContain("📌");
  });
});
