import { describe, expect, it } from "vitest";
import type { Bookmark } from "../src/core/feed";
import { selectUnposted } from "../src/core/select";

function bookmark(url: string, bookmarkedAt: string): Bookmark {
  return { url, title: "t", comment: "", tags: [], bookmarkedAt };
}

describe("selectUnposted", () => {
  const feed = [
    bookmark("https://example.com/newest", "2026-07-09T03:00:00Z"),
    bookmark("https://example.com/middle", "2026-07-09T02:00:00Z"),
    bookmark("https://example.com/oldest", "2026-07-09T01:00:00Z"),
  ];

  it("filters out posted bookmarks and sorts oldest first", () => {
    const posted = new Set(["https://example.com/middle"]);
    const result = selectUnposted(feed, (url) => posted.has(url), 5);
    expect(result.map((b) => b.url)).toEqual([
      "https://example.com/oldest",
      "https://example.com/newest",
    ]);
  });

  it("limits the number of results to max", () => {
    const result = selectUnposted(feed, () => false, 2);
    expect(result.map((b) => b.url)).toEqual([
      "https://example.com/oldest",
      "https://example.com/middle",
    ]);
  });

  it("returns an empty array when everything is posted", () => {
    expect(selectUnposted(feed, () => true, 5)).toEqual([]);
  });
});
