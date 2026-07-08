import { describe, expect, it } from "vitest";
import { decodeHtml, extractOgp } from "../src/core/ogp";

describe("extractOgp", () => {
  it("extracts og:title, og:description and og:image", () => {
    const html = `<html><head>
      <meta property="og:title" content="記事タイトル" />
      <meta property="og:description" content="記事の説明" />
      <meta property="og:image" content="https://example.com/image.png" />
    </head><body></body></html>`;
    expect(extractOgp(html, "https://example.com/article")).toEqual({
      title: "記事タイトル",
      description: "記事の説明",
      imageUrl: "https://example.com/image.png",
    });
  });

  it("handles reversed attribute order and single quotes", () => {
    const html = `<meta content='Reversed' property='og:title'>`;
    expect(extractOgp(html, "https://example.com/")).toEqual({ title: "Reversed" });
  });

  it("resolves a relative og:image against the base URL", () => {
    const html = `<meta property="og:image" content="/img/thumb.jpg">`;
    expect(extractOgp(html, "https://example.com/a/b")).toEqual({
      imageUrl: "https://example.com/img/thumb.jpg",
    });
  });

  it("decodes basic HTML entities in content", () => {
    const html = `<meta property="og:title" content="A &amp; B &quot;quoted&quot;">`;
    expect(extractOgp(html, "https://example.com/")).toEqual({ title: 'A & B "quoted"' });
  });

  it("returns an empty object when no OGP tags exist", () => {
    expect(extractOgp("<html><body>hi</body></html>", "https://example.com/")).toEqual({});
  });

  it("uses the first occurrence when a property is duplicated", () => {
    const html = `
      <meta property="og:title" content="First">
      <meta property="og:title" content="Second">`;
    expect(extractOgp(html, "https://example.com/")).toEqual({ title: "First" });
  });

  it("keeps apostrophes inside double-quoted content", () => {
    const html = `<meta property="og:description" content="It's a great day">`;
    expect(extractOgp(html, "https://example.com/")).toEqual({
      description: "It's a great day",
    });
  });

  it("keeps double quotes inside single-quoted content", () => {
    const html = `<meta property='og:title' content='He said "hi"'>`;
    expect(extractOgp(html, "https://example.com/")).toEqual({ title: 'He said "hi"' });
  });
});

describe("decodeHtml", () => {
  // "日本語" in Shift_JIS bytes
  const SJIS_NIHONGO = [0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea];

  function sjisHtml(prefixAscii: string): ArrayBuffer {
    const ascii = Array.from(prefixAscii, (c) => c.charCodeAt(0));
    return new Uint8Array([...ascii, ...SJIS_NIHONGO]).buffer;
  }

  it("decodes using the charset from the Content-Type header", () => {
    const html = decodeHtml(sjisHtml("<html>"), "text/html; charset=Shift_JIS");
    expect(html).toBe("<html>日本語");
  });

  it("decodes using a meta charset when the header has none", () => {
    const html = decodeHtml(sjisHtml(`<meta charset="shift_jis">`), "text/html");
    expect(html).toBe(`<meta charset="shift_jis">日本語`);
  });

  it("defaults to UTF-8 when no charset is declared", () => {
    const bytes = new TextEncoder().encode("<html>日本語").buffer as ArrayBuffer;
    expect(decodeHtml(bytes, "text/html")).toBe("<html>日本語");
  });

  it("falls back to UTF-8 on an unknown charset label", () => {
    const bytes = new TextEncoder().encode("abc").buffer as ArrayBuffer;
    expect(decodeHtml(bytes, "text/html; charset=bogus-charset")).toBe("abc");
  });
});
