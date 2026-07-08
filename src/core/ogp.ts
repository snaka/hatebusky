export interface OgpData {
  title?: string;
  description?: string;
  imageUrl?: string;
}

const META_TAG_RE = /<meta\s[^>]*>/gi;

function readAttr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2];
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function extractOgp(html: string, baseUrl: string): OgpData {
  const result: OgpData = {};
  for (const tag of html.match(META_TAG_RE) ?? []) {
    const property = readAttr(tag, "property");
    const content = readAttr(tag, "content");
    if (!property || content === undefined) continue;
    const value = decodeEntities(content);
    if (property === "og:title" && result.title === undefined) {
      result.title = value;
    } else if (property === "og:description" && result.description === undefined) {
      result.description = value;
    } else if (property === "og:image" && result.imageUrl === undefined) {
      try {
        result.imageUrl = new URL(value, baseUrl).toString();
      } catch {
        // ignore malformed image URLs
      }
    }
  }
  return result;
}
