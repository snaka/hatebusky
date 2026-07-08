# hatebusky — Design Document

Date: 2026-07-09
Status: Approved

## Overview

hatebusky mirrors the user's public Hatena Bookmark entries to an AT Protocol
account (Bluesky or any other PDS) as posts. It polls the public Hatena
Bookmark RSS feed on a schedule, detects bookmarks that have not been posted
yet, and posts each one as "comment text + link card".

Primary user: the author, but designed to be self-hostable by anyone
(OSS, configuration via secrets/environment only — no multi-tenant support).

## Requirements

- Source: all **public** bookmarks of a single Hatena user (no Hatena
  authentication; the public RSS feed is sufficient).
- Target: a single AT Protocol account. The PDS URL is configurable so the
  target can be the user's main account or a dedicated bot account on any PDS.
- Post format: the bookmark comment as post text, Hatena tags appended as
  hashtags (with rich-text facets), and the bookmarked URL attached as an
  external-link embed (link card) with OGP title/description/image.
- Latency: a new bookmark should appear on Bluesky within minutes to ~15
  minutes.
- Language/runtime: TypeScript on Cloudflare Workers.

## Architecture

Cloudflare Workers (TypeScript) + Cron Trigger (every 10 minutes, configurable
in `wrangler.toml`) + Workers KV for posted-state tracking.

```
[Cron Trigger, every 10 min]
   |
   v
1. Fetch Hatena public RSS
   https://b.hatena.ne.jp/{HATENA_USER}/bookmark.rss
   (contains title, URL, comment, tags, timestamp)
   |
   v
2. Diff against KV -> list of not-yet-posted bookmarks (oldest first)
   |
   v
3. For each bookmark (up to MAX_POSTS_PER_RUN, default 5):
   - Fetch the bookmarked page's OGP metadata, build a link card
     (upload og:image via uploadBlob when available)
   - Build post text = comment + hashtags (facets via @atproto/api RichText)
   - Create the post via @atproto/api
   |
   v
4. Mark each bookmark as posted in KV only after its post succeeds
```

### Components

- `src/core/feed.ts` — parse the Hatena Bookmark RSS (RDF) feed into a list
  of `Bookmark { url, title, comment, tags, bookmarkedAt }`. Pure function
  over the XML string.
- `src/core/post-builder.ts` — build the post record: text assembly
  (comment + hashtags), grapheme-limit handling, facet generation. Pure.
- `src/core/ogp.ts` — fetch a page and extract OGP metadata
  (og:title / og:description / og:image) with graceful fallbacks.
- `src/worker.ts` — thin Workers entry point: cron handler, KV wiring,
  secrets, Bluesky agent session, per-item orchestration.

Core logic is platform-agnostic so a CLI runner can be added later without
touching `src/core/`.

### Configuration

Secrets (via `wrangler secret`):

- `BLUESKY_IDENTIFIER` — handle or DID
- `BLUESKY_APP_PASSWORD` — app password

Vars (in `wrangler.toml`):

- `HATENA_USER` — Hatena account whose public bookmarks are mirrored
- `PDS_URL` — default `https://bsky.social`
- `MAX_POSTS_PER_RUN` — default `5`
- `DRY_RUN` — when true, log what would be posted instead of posting

### State (Workers KV)

- `posted:<bookmark URL>` → ISO timestamp. Presence means "already posted".
- `initialized` → set on first run. On the very first run the worker marks
  every item currently in the feed as posted **without posting**, preventing
  a backlog flood.

KV free-tier limits (1k writes/day, 100k reads/day) are far above expected
usage (144 cron runs/day, a handful of bookmarks/day).

## Post format details

- Text = comment, then hashtags derived from Hatena tags (`#tech #AI`),
  as rich-text facets.
- No comment → hashtags only; no comment and no tags → empty text with the
  link card only (the card carries the title).
- If text exceeds Bluesky's 300-grapheme limit (possible: 100-char comment
  plus many tags), drop hashtags from the end until it fits. The comment
  itself always fits.
- Link card: external embed with OGP title/description; og:image is uploaded
  as a blob. If the image exceeds Bluesky's blob size limit (~1 MB), fall
  back to a card without an image (no resizing — YAGNI).

## Error handling

- Each bookmark is processed in its own try/catch: one failure does not
  block the others, and a failed item is simply not marked as posted, so the
  next cron run retries it automatically.
- Post first, then mark in KV. A lost mark could cause a rare duplicate
  post; a lost post cannot happen. Accepted trade-off.
- OGP fetch failure → fall back to a card built from the RSS title, no image.
- RSS fetch failure → log and skip this run; next run retries.

## Out of scope

- Private bookmarks (would require Hatena OAuth).
- Following bookmark deletions or comment edits (posts are one-shot).
- Tag-based include/exclude filtering (may be added later).
- Multi-user / hosted service operation.

## Testing

- Unit tests (Vitest) for everything in `src/core/`: RSS parsing,
  post-text assembly, grapheme counting/truncation, tag-to-hashtag
  conversion. Developed test-first.
- Workers integration verified manually via `wrangler dev` plus the
  `DRY_RUN` mode.

## Dependencies

- `@atproto/api` — official AT Protocol SDK.
- `fast-xml-parser` — RSS/RDF parsing; works on Workers (no DOM available).
- Dev: `wrangler`, `vitest`, `typescript`.

All are widely used mainstream packages; a supply-chain check will be
performed and reported at installation time per user policy.

## Repository layout

```
src/
  core/
    feed.ts
    post-builder.ts
    ogp.ts
  worker.ts
test/
wrangler.toml
README.md        # setup instructions (English)
```
