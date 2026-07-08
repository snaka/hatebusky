const GRAPHEME_LIMIT = 300;
const segmenter = new Intl.Segmenter();

export function countGraphemes(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
}

export function toHashtag(tag: string): string {
  return "#" + tag.replace(/\s+/g, "");
}

export function buildPostText(comment: string, tags: string[]): string {
  const hashtags = tags.map(toHashtag);
  for (;;) {
    const parts = [comment, hashtags.join(" ")].filter((part) => part.length > 0);
    const text = parts.join("\n");
    if (countGraphemes(text) <= GRAPHEME_LIMIT || hashtags.length === 0) {
      return text;
    }
    hashtags.pop();
  }
}
