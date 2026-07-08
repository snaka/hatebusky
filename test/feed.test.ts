import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/core/feed";

const FEED_WITH_ITEMS = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
 xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
 xmlns="http://purl.org/rss/1.0/"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:hatena="http://www.hatena.ne.jp/info/xmlns#"
>
<channel rdf:about="https://b.hatena.ne.jp/example/bookmark">
<title>example&#x306E;&#x306F;&#x3066;&#x306A;&#x30D6;&#x30C3;&#x30AF;&#x30DE;&#x30FC;&#x30AF;</title>
<link>https://b.hatena.ne.jp/example/bookmark</link>
<items>
 <rdf:Seq>
  <rdf:li rdf:resource="https://example.com/article1" />
  <rdf:li rdf:resource="https://example.com/article2?a=1&amp;b=2" />
 </rdf:Seq>
</items>
</channel>
<item rdf:about="https://example.com/article1">
<title>&#x8A18;&#x4E8B;1&#x306E;&#x30BF;&#x30A4;&#x30C8;&#x30EB;</title>
<link>https://example.com/article1</link>
<description>&#x3053;&#x308C;&#x306F;&#x30B3;&#x30E1;&#x30F3;&#x30C8;</description>
<dc:date>2026-07-08T09:09:48Z</dc:date>
<dc:subject>tech</dc:subject>
<dc:subject>AI</dc:subject>
<hatena:bookmarkcount>10</hatena:bookmarkcount>
</item>
<item rdf:about="https://example.com/article2?a=1&amp;b=2">
<title>&#x8A18;&#x4E8B;2</title>
<link>https://example.com/article2?a=1&amp;b=2</link>
<description></description>
<dc:date>2026-07-09T01:00:00Z</dc:date>
</item>
</rdf:RDF>`;

const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
 xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
 xmlns="http://purl.org/rss/1.0/"
>
<channel rdf:about="https://b.hatena.ne.jp/example/bookmark">
<title>example&#x306E;&#x306F;&#x3066;&#x306A;&#x30D6;&#x30C3;&#x30AF;&#x30DE;&#x30FC;&#x30AF;</title>
<link>https://b.hatena.ne.jp/example/bookmark</link>
<items><rdf:Seq></rdf:Seq></items>
</channel>
</rdf:RDF>`;

describe("parseFeed", () => {
  it("parses items with title, link, comment, tags and date", () => {
    const bookmarks = parseFeed(FEED_WITH_ITEMS);
    expect(bookmarks).toHaveLength(2);
    expect(bookmarks[0]).toEqual({
      url: "https://example.com/article1",
      title: "記事1のタイトル",
      comment: "これはコメント",
      tags: ["tech", "AI"],
      bookmarkedAt: "2026-07-08T09:09:48Z",
    });
  });

  it("handles items without comment and tags", () => {
    const bookmarks = parseFeed(FEED_WITH_ITEMS);
    expect(bookmarks[1]).toEqual({
      url: "https://example.com/article2?a=1&b=2",
      title: "記事2",
      comment: "",
      tags: [],
      bookmarkedAt: "2026-07-09T01:00:00Z",
    });
  });

  it("returns an empty array for a feed without items", () => {
    expect(parseFeed(EMPTY_FEED)).toEqual([]);
  });
});
