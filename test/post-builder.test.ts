import { describe, expect, it } from "vitest";
import { buildPostText, countGraphemes, toHashtag } from "../src/core/post-builder";

describe("countGraphemes", () => {
  it("counts multi-codepoint emoji as one grapheme", () => {
    expect(countGraphemes("👨‍👩‍👧‍👦")).toBe(1);
    expect(countGraphemes("あいう")).toBe(3);
    expect(countGraphemes("")).toBe(0);
  });
});

describe("toHashtag", () => {
  it("prefixes # and strips whitespace inside the tag", () => {
    expect(toHashtag("tech")).toBe("#tech");
    expect(toHashtag("機械 学習")).toBe("#機械学習");
  });
});

describe("buildPostText", () => {
  it("joins comment and hashtags with a newline", () => {
    expect(buildPostText("良い記事", ["tech", "AI"])).toBe("良い記事\n#tech #AI");
  });

  it("returns hashtags only when there is no comment", () => {
    expect(buildPostText("", ["tech"])).toBe("#tech");
  });

  it("returns an empty string when there is no comment and no tags", () => {
    expect(buildPostText("", [])).toBe("");
  });

  it("drops hashtags from the end to fit the 300-grapheme limit", () => {
    const comment = "あ".repeat(290);
    // "#ab" fits (290 + 1 + 3 = 294) but adding " #cdefghijkl" (12 more) would exceed 300
    expect(buildPostText(comment, ["ab", "cdefghijkl"])).toBe(`${comment}\n#ab`);
  });

  it("drops all hashtags when none of them fit", () => {
    const comment = "あ".repeat(299);
    expect(buildPostText(comment, ["tech"])).toBe(comment);
  });
});
