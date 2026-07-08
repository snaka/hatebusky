export interface OgpData {
  title?: string;
  description?: string;
  imageUrl?: string;
}

const META_TAG_RE = /<meta\s[^>]*>/gi;
const CHARSET_HEADER_RE = /charset=["']?([\w-]+)/i;
const META_CHARSET_RE = /<meta\s[^>]*charset=["']?([\w-]+)/i;

export function decodeHtml(bytes: ArrayBuffer, contentTypeHeader: string | null): string {
  const utf8 = new TextDecoder("utf-8");
  const headerCharset = contentTypeHeader?.match(CHARSET_HEADER_RE)?.[1];
  // sniff <meta charset> from the first bytes; charset declarations are ASCII
  const head = utf8.decode(bytes.slice(0, 2048));
  const metaCharset = head.match(META_CHARSET_RE)?.[1];
  const charset = (headerCharset ?? metaCharset ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    // unknown charset label: fall back to UTF-8
    return utf8.decode(bytes);
  }
}

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
