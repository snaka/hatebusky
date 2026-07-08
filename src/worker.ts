import { AtpAgent, BlobRef, RichText } from "@atproto/api";
import type { Bookmark } from "./core/feed";
import { parseFeed } from "./core/feed";
import type { OgpData } from "./core/ogp";
import { extractOgp } from "./core/ogp";
import { buildPostText } from "./core/post-builder";
import { selectUnposted } from "./core/select";

export interface Env {
  STATE: KVNamespace;
  HATENA_USER: string;
  PDS_URL: string;
  MAX_POSTS_PER_RUN: string;
  DRY_RUN: string;
  BLUESKY_IDENTIFIER: string;
  BLUESKY_APP_PASSWORD: string;
}

// Stay safely under Bluesky's 1,000,000-byte blob limit
const MAX_IMAGE_BYTES = 976 * 1024;
const USER_AGENT = "hatebusky (+https://github.com/snaka/hatebusky)";

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await run(env);
  },
};

async function run(env: Env): Promise<void> {
  const dryRun = env.DRY_RUN === "true";
  const feedUrl = `https://b.hatena.ne.jp/${env.HATENA_USER}/bookmark.rss`;

  const res = await fetch(feedUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    console.error(`feed fetch failed: ${res.status} ${feedUrl}`);
    return;
  }
  const bookmarks = parseFeed(await res.text());

  if (!dryRun) {
    const initialized = await env.STATE.get("initialized");
    if (initialized === null) {
      for (const b of bookmarks) {
        await env.STATE.put(`posted:${b.url}`, new Date().toISOString());
      }
      await env.STATE.put("initialized", new Date().toISOString());
      console.log(`initialized: marked ${bookmarks.length} existing bookmarks as posted`);
      return;
    }
  }

  const postedFlags = await Promise.all(
    bookmarks.map((b) => env.STATE.get(`posted:${b.url}`)),
  );
  const postedUrls = new Set(
    bookmarks.filter((_, i) => postedFlags[i] !== null).map((b) => b.url),
  );
  const targets = selectUnposted(
    bookmarks,
    (url) => postedUrls.has(url),
    Number(env.MAX_POSTS_PER_RUN),
  );
  if (targets.length === 0) {
    console.log("no new bookmarks");
    return;
  }

  const agent = new AtpAgent({ service: env.PDS_URL });
  if (!dryRun) {
    await agent.login({
      identifier: env.BLUESKY_IDENTIFIER,
      password: env.BLUESKY_APP_PASSWORD,
    });
  }

  for (const bookmark of targets) {
    try {
      await postBookmark(agent, bookmark, dryRun);
      if (!dryRun) {
        await env.STATE.put(`posted:${bookmark.url}`, new Date().toISOString());
      }
    } catch (err) {
      // leave the bookmark unmarked so the next run retries it
      console.error(`post failed for ${bookmark.url}:`, err);
    }
  }
}

async function postBookmark(agent: AtpAgent, bookmark: Bookmark, dryRun: boolean): Promise<void> {
  const text = buildPostText(bookmark.comment, bookmark.tags);
  const embed = await buildEmbed(agent, bookmark, dryRun);

  if (dryRun) {
    console.log(
      `[DRY_RUN] would post: ${JSON.stringify({ text, external: embed.external })}`,
    );
    return;
  }

  const rt = new RichText({ text });
  await rt.detectFacets(agent);
  await agent.post({
    text: rt.text,
    facets: rt.facets,
    embed,
    createdAt: new Date().toISOString(),
  });
  console.log(`posted: ${bookmark.url}`);
}

interface ExternalEmbed {
  $type: "app.bsky.embed.external";
  external: {
    uri: string;
    title: string;
    description: string;
    thumb?: BlobRef;
  };
}

async function buildEmbed(
  agent: AtpAgent,
  bookmark: Bookmark,
  dryRun: boolean,
): Promise<ExternalEmbed> {
  let ogp: OgpData = {};
  try {
    const res = await fetch(bookmark.url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (res.ok && contentType.includes("text/html")) {
      ogp = extractOgp(await res.text(), res.url);
    }
  } catch (err) {
    console.warn(`ogp fetch failed for ${bookmark.url}:`, err);
  }

  const embed: ExternalEmbed = {
    $type: "app.bsky.embed.external",
    external: {
      uri: bookmark.url,
      title: ogp.title ?? bookmark.title,
      description: ogp.description ?? "",
    },
  };

  if (ogp.imageUrl !== undefined && !dryRun) {
    const thumb = await uploadThumbnail(agent, ogp.imageUrl);
    if (thumb !== undefined) {
      embed.external.thumb = thumb;
    }
  }
  return embed;
}

async function uploadThumbnail(agent: AtpAgent, imageUrl: string): Promise<BlobRef | undefined> {
  try {
    const res = await fetch(imageUrl, { headers: { "User-Agent": USER_AGENT } });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.startsWith("image/")) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) return undefined;
    const upload = await agent.uploadBlob(bytes, { encoding: contentType });
    return upload.data.blob;
  } catch (err) {
    console.warn(`thumbnail upload failed for ${imageUrl}:`, err);
    return undefined;
  }
}
