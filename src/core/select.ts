import type { Bookmark } from "./feed";

export function selectUnposted(
  bookmarks: Bookmark[],
  isPosted: (url: string) => boolean,
  max: number,
): Bookmark[] {
  return bookmarks
    .filter((b) => !isPosted(b.url))
    .sort((a, b) => a.bookmarkedAt.localeCompare(b.bookmarkedAt))
    .slice(0, max);
}
