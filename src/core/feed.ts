import { XMLParser } from "fast-xml-parser";

export interface Bookmark {
  url: string;
  title: string;
  comment: string;
  tags: string[];
  bookmarkedAt: string;
}

export function parseFeed(xml: string): Bookmark[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    // keep all values as strings; Hatena feeds contain numeric-looking text
    parseTagValue: false,
    isArray: (name) => name === "item" || name === "dc:subject",
    htmlEntities: true,
  });
  const doc = parser.parse(xml);
  const items: unknown[] = doc?.["rdf:RDF"]?.item ?? [];
  return items.map((raw) => {
    const item = raw as Record<string, unknown>;
    const subjects = (item["dc:subject"] ?? []) as unknown[];
    return {
      url: String(item.link ?? ""),
      title: String(item.title ?? ""),
      comment: item.description != null ? String(item.description) : "",
      tags: subjects.map(String),
      bookmarkedAt: String(item["dc:date"] ?? ""),
    };
  });
}
