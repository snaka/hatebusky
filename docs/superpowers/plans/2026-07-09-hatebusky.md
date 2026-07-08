# hatebusky 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 公開はてなブックマークを Cloudflare Workers の cron で定期取得し、未投稿分を Bluesky（任意の AT Protocol PDS）へ「コメント + ハッシュタグ + リンクカード」として投稿するワーカーを作る。

**Architecture:** Cloudflare Workers + Cron Trigger（10分毎）+ Workers KV。プラットフォーム非依存の純粋ロジック（RSS解析・本文組み立て・OGP抽出・投稿対象選択）を `src/core/` に置き、`src/worker.ts` が cron・KV・`@atproto/api` を配線する薄いエントリポイントになる。

**Tech Stack:** TypeScript / `@atproto/api`（AT Protocol 公式SDK）/ `fast-xml-parser`（RSS解析）/ Vitest / Wrangler

**Spec:** `docs/superpowers/specs/2026-07-09-hatebusky-design.md`

## Global Constraints

- ドキュメント（README・設計・計画）は日本語、コード内コメント・識別子は英語（`CLAUDE.md` 参照）。
- 対象ははてなの**公開**ブックマークのみ。フィード URL は `https://b.hatena.ne.jp/{HATENA_USER}/bookmark.rss`（RSS 1.0 / RDF 形式）。
- 投稿本文は 300 書記素以内。超過時はハッシュタグを末尾から削る（コメント自体は必ず収まる。はてブコメントは最大100文字）。
- `DRY_RUN=true` のときは一切の副作用なし（投稿しない・KV に書かない・ログインしない）。投稿予定の内容をログに出すのみ。
- 初回実行（KV に `initialized` キーがない状態、かつ DRY_RUN でない）はフィードの全アイテムを投稿せずに投稿済みマークして終了する（過去分の洪水防止）。
- 「投稿成功 → KV 記録」の順を守る（取りこぼしゼロ、稀な二重投稿は許容）。
- 1件の失敗は他のブックマークの処理をブロックしない（アイテムごとに try/catch）。
- 新規依存パッケージのインストール前にサプライチェーン確認を行い、結果をユーザーに報告する（グローバル CLAUDE.md のポリシー）。

## 事前調査で確認済みの事実

はてブの実フィード（2026-07-09 取得）より:

- ルート要素は `rdf:RDF`、アイテムは `<item rdf:about="...">` の繰り返し。
- 各 item の子要素: `title`、`link`、`description`（ユーザーのコメント。空のことあり）、`dc:date`（ISO 8601 UTC 例 `2026-07-08T09:09:48Z`）、`dc:subject`（タグ。0個〜複数個）。
- ブックマーク0件のユーザーでは `<item>` が1つも存在しない（channel のみ）。
- フィードは新しい順。投稿は古い順に行うため `dc:date` でソートし直す。

---

### Task 1: プロジェクト初期化

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `wrangler.toml`, `.gitignore`, `src/worker.ts`（仮実装）

**Interfaces:**
- Consumes: なし
- Produces: `npm test`（vitest）、`npm run typecheck`（tsc --noEmit）が通る土台。`wrangler.toml` の KV バインディング名 `STATE`、環境変数 `HATENA_USER` / `PDS_URL` / `MAX_POSTS_PER_RUN` / `DRY_RUN`。

- [ ] **Step 1: 依存パッケージのサプライチェーン確認**

以下を実行し、各パッケージの最終更新日・週間DL数・メンテナに不審な点がないか確認して、結果をユーザーに簡潔に報告する（`@atproto/api` は Bluesky 公式、`fast-xml-parser`・`wrangler`・`vitest`・`typescript` は定番だが、タイポスクワットしていない正確な名前でインストールすることを確認する）。

```bash
npm view @atproto/api name version time.modified maintainers
npm view fast-xml-parser name version time.modified maintainers
npm view wrangler name version time.modified
npm view vitest name version time.modified
```

期待: いずれも正規パッケージで直近も継続的にリリースされていること。異常があれば停止してユーザーに報告。

- [ ] **Step 2: npm プロジェクト作成と依存インストール**

```bash
npm init -y
npm pkg set type=module private=true
npm install @atproto/api fast-xml-parser
npm install -D typescript vitest wrangler @cloudflare/workers-types
npm pkg set scripts.test="vitest run" scripts.typecheck="tsc --noEmit" scripts.dev="wrangler dev --test-scheduled" scripts.deploy="wrangler deploy"
```

期待: エラーなくインストール完了。`package.json` に dependencies / devDependencies が入る。

- [ ] **Step 3: 設定ファイルを作成**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

`wrangler.toml`（KV の `id` はデプロイ時に `wrangler kv namespace create STATE` の出力で差し替える。ローカル開発では placeholder のままで動く）:

```toml
name = "hatebusky"
main = "src/worker.ts"
compatibility_date = "2026-07-01"
compatibility_flags = ["nodejs_compat"]

[triggers]
crons = ["*/10 * * * *"]

[[kv_namespaces]]
binding = "STATE"
id = "PLACEHOLDER_REPLACE_ON_DEPLOY"

[vars]
HATENA_USER = "snaka"
PDS_URL = "https://bsky.social"
MAX_POSTS_PER_RUN = "5"
DRY_RUN = "false"
```

`.gitignore`:

```
node_modules/
.wrangler/
.dev.vars
```

`src/worker.ts`（仮実装。Task 6 で置き換える）:

```ts
export default {
  async scheduled(): Promise<void> {
    console.log("hatebusky: not implemented yet");
  },
};
```

- [ ] **Step 4: 型チェックが通ることを確認**

```bash
npm run typecheck
```

期待: エラーなし（exit 0）。

- [ ] **Step 5: コミット**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts wrangler.toml .gitignore src/worker.ts
git commit -m "chore: scaffold Cloudflare Workers project with TypeScript, Vitest, Wrangler"
```

---

### Task 2: RSS フィード解析（`src/core/feed.ts`）

**Files:**
- Create: `src/core/feed.ts`
- Test: `test/feed.test.ts`

**Interfaces:**
- Consumes: なし（純粋関数）
- Produces:
  - `interface Bookmark { url: string; title: string; comment: string; tags: string[]; bookmarkedAt: string }`（`bookmarkedAt` は ISO 8601 文字列）
  - `function parseFeed(xml: string): Bookmark[]`（フィード出現順のまま返す。ソートは呼び出し側の責務）

- [ ] **Step 1: 失敗するテストを書く**

`test/feed.test.ts`:

```ts
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
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npx vitest run test/feed.test.ts
```

期待: FAIL（`Cannot find module '../src/core/feed'` 相当のエラー）。

- [ ] **Step 3: 実装を書く**

`src/core/feed.ts`:

```ts
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
```

- [ ] **Step 4: テストが通ることを確認**

```bash
npx vitest run test/feed.test.ts && npm run typecheck
```

期待: 3 tests PASS、型チェックもエラーなし。

- [ ] **Step 5: コミット**

```bash
git add src/core/feed.ts test/feed.test.ts
git commit -m "feat: parse Hatena Bookmark RSS (RDF) feed into Bookmark objects"
```

---

### Task 3: 投稿本文の組み立て（`src/core/post-builder.ts`）

**Files:**
- Create: `src/core/post-builder.ts`
- Test: `test/post-builder.test.ts`

**Interfaces:**
- Consumes: なし（純粋関数）
- Produces:
  - `function buildPostText(comment: string, tags: string[]): string` — コメント + 改行 + ハッシュタグ列。300 書記素超過時はハッシュタグを末尾から削る。コメントもタグもなければ `""`。
  - `function countGraphemes(text: string): number`
  - `function toHashtag(tag: string): string` — 空白類を除去して `#` を付ける。

- [ ] **Step 1: 失敗するテストを書く**

`test/post-builder.test.ts`:

```ts
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
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npx vitest run test/post-builder.test.ts
```

期待: FAIL（モジュールが存在しない）。

- [ ] **Step 3: 実装を書く**

`src/core/post-builder.ts`:

```ts
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
```

- [ ] **Step 4: テストが通ることを確認**

```bash
npx vitest run test/post-builder.test.ts && npm run typecheck
```

期待: 6 tests PASS、型チェックもエラーなし。

- [ ] **Step 5: コミット**

```bash
git add src/core/post-builder.ts test/post-builder.test.ts
git commit -m "feat: build post text from comment and hashtags within grapheme limit"
```

---

### Task 4: OGP メタデータ抽出（`src/core/ogp.ts`）

**Files:**
- Create: `src/core/ogp.ts`
- Test: `test/ogp.test.ts`

**Interfaces:**
- Consumes: なし（純粋関数。HTML の fetch は Task 6 の worker 側で行う）
- Produces:
  - `interface OgpData { title?: string; description?: string; imageUrl?: string }`
  - `function extractOgp(html: string, baseUrl: string): OgpData` — `og:image` の相対 URL は `baseUrl` 基準で絶対化。見つからないフィールドは `undefined`。

- [ ] **Step 1: 失敗するテストを書く**

`test/ogp.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractOgp } from "../src/core/ogp";

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
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npx vitest run test/ogp.test.ts
```

期待: FAIL（モジュールが存在しない）。

- [ ] **Step 3: 実装を書く**

`src/core/ogp.ts`:

```ts
export interface OgpData {
  title?: string;
  description?: string;
  imageUrl?: string;
}

const META_TAG_RE = /<meta\s[^>]*>/gi;

function readAttr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match?.[1];
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
```

- [ ] **Step 4: テストが通ることを確認**

```bash
npx vitest run test/ogp.test.ts && npm run typecheck
```

期待: 6 tests PASS、型チェックもエラーなし。

- [ ] **Step 5: コミット**

```bash
git add src/core/ogp.ts test/ogp.test.ts
git commit -m "feat: extract OGP metadata from HTML"
```

---

### Task 5: 投稿対象の選択（`src/core/select.ts`）

**Files:**
- Create: `src/core/select.ts`
- Test: `test/select.test.ts`

**Interfaces:**
- Consumes: Task 2 の `Bookmark`
- Produces:
  - `function selectUnposted(bookmarks: Bookmark[], isPosted: (url: string) => boolean, max: number): Bookmark[]` — 未投稿のみ、`bookmarkedAt` 昇順（古い順）、先頭 `max` 件。

- [ ] **Step 1: 失敗するテストを書く**

`test/select.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Bookmark } from "../src/core/feed";
import { selectUnposted } from "../src/core/select";

function bookmark(url: string, bookmarkedAt: string): Bookmark {
  return { url, title: "t", comment: "", tags: [], bookmarkedAt };
}

describe("selectUnposted", () => {
  const feed = [
    bookmark("https://example.com/newest", "2026-07-09T03:00:00Z"),
    bookmark("https://example.com/middle", "2026-07-09T02:00:00Z"),
    bookmark("https://example.com/oldest", "2026-07-09T01:00:00Z"),
  ];

  it("filters out posted bookmarks and sorts oldest first", () => {
    const posted = new Set(["https://example.com/middle"]);
    const result = selectUnposted(feed, (url) => posted.has(url), 5);
    expect(result.map((b) => b.url)).toEqual([
      "https://example.com/oldest",
      "https://example.com/newest",
    ]);
  });

  it("limits the number of results to max", () => {
    const result = selectUnposted(feed, () => false, 2);
    expect(result.map((b) => b.url)).toEqual([
      "https://example.com/oldest",
      "https://example.com/middle",
    ]);
  });

  it("returns an empty array when everything is posted", () => {
    expect(selectUnposted(feed, () => true, 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
npx vitest run test/select.test.ts
```

期待: FAIL（モジュールが存在しない）。

- [ ] **Step 3: 実装を書く**

`src/core/select.ts`:

```ts
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
```

- [ ] **Step 4: テストが通ることを確認**

```bash
npx vitest run test/select.test.ts && npm run typecheck
```

期待: 3 tests PASS、型チェックもエラーなし。

- [ ] **Step 5: コミット**

```bash
git add src/core/select.ts test/select.test.ts
git commit -m "feat: select unposted bookmarks oldest-first with a per-run cap"
```

---

### Task 6: Worker エントリポイント（`src/worker.ts`）

**Files:**
- Modify: `src/worker.ts`（Task 1 の仮実装を全面置き換え）
- Create: `.dev.vars`（ローカル動作確認用。gitignore 済み）

**Interfaces:**
- Consumes: `parseFeed` / `Bookmark`（Task 2）、`buildPostText`（Task 3）、`extractOgp` / `OgpData`（Task 4）、`selectUnposted`（Task 5）、`@atproto/api` の `AtpAgent` / `RichText`
- Produces: Cloudflare Workers の `scheduled` ハンドラ。KV キー設計 `posted:<url>` → ISO タイムスタンプ、`initialized` → ISO タイムスタンプ。

- [ ] **Step 1: worker を実装する**

`src/worker.ts` を以下で置き換える:

```ts
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
```

- [ ] **Step 2: 型チェックと全テストが通ることを確認**

```bash
npm run typecheck && npm test
```

期待: 型エラーなし、既存テスト（feed 3 / post-builder 6 / ogp 6 / select 3 = 計18）すべて PASS。

- [ ] **Step 3: DRY_RUN でローカル動作確認**

`.dev.vars` を作成（ローカル専用。シークレットはダミーで良い — DRY_RUN では使われない）:

```
BLUESKY_IDENTIFIER=dummy.example.com
BLUESKY_APP_PASSWORD=dummy
```

`wrangler.toml` の `[vars]` を一時的に変更せず、コマンドラインで上書きして実行する。公開ブクマが多いユーザー（例: 任意のアクティブユーザー）を `HATENA_USER` に指定:

```bash
npx wrangler dev --test-scheduled --var DRY_RUN:true --var HATENA_USER:<公開ブクマのあるユーザーID>
```

別ターミナルで cron をトリガー:

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

期待: wrangler のログに `[DRY_RUN] would post: {"text":"...","external":{...}}` が最大5件出力される（DRY_RUN では KV に書かないため、再実行しても同じ結果になる）。`text` にコメント+ハッシュタグ、`external` に OGP 由来の title / description が入っていることを目視確認。

- [ ] **Step 4: コミット**

```bash
git add src/worker.ts
git commit -m "feat: wire cron handler with KV state, link card embed and Bluesky posting"
```

---

### Task 7: README とデプロイ手順

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: Task 1〜6 の成果物すべて
- Produces: セルフホスト手順を含む日本語 README

- [ ] **Step 1: README.md を書く**

`README.md`:

````markdown
# hatebusky

自分の公開[はてなブックマーク](https://b.hatena.ne.jp/)を Bluesky（または任意の AT Protocol PDS）のアカウントに自動投稿する Cloudflare Worker です。

- はてブの公開 RSS を10分ごとにポーリングし、新しいブックマークを検出
- ブックマークコメントを本文、タグをハッシュタグとして投稿
- ブックマーク先ページの OGP（タイトル・説明・画像）付きリンクカードを添付
- はてな側の認証は不要（公開ブックマークのみが対象）

## 必要なもの

- Cloudflare アカウント（Workers / KV の無料枠で動作します）
- Bluesky（または他の PDS）のアカウントと[アプリパスワード](https://bsky.app/settings/app-passwords)
- Node.js

## セットアップ

```bash
git clone https://github.com/snaka/hatebusky.git
cd hatebusky
npm install
```

### 1. KV ネームスペースを作成

```bash
npx wrangler kv namespace create STATE
```

出力された `id` を `wrangler.toml` の `[[kv_namespaces]]` の `id` に設定します。

### 2. 変数を設定

`wrangler.toml` の `[vars]` を編集します。

| 変数 | 説明 | デフォルト |
| --- | --- | --- |
| `HATENA_USER` | ミラー元のはてな ID | — |
| `PDS_URL` | 投稿先 PDS の URL | `https://bsky.social` |
| `MAX_POSTS_PER_RUN` | 1回の実行で投稿する最大件数 | `5` |
| `DRY_RUN` | `true` で投稿せずログ出力のみ（KV にも書き込まない） | `false` |

### 3. シークレットを設定

```bash
npx wrangler secret put BLUESKY_IDENTIFIER   # 例: yourname.bsky.social
npx wrangler secret put BLUESKY_APP_PASSWORD # アプリパスワード
```

### 4. デプロイ

```bash
npx wrangler deploy
```

初回実行時は、その時点でフィードに含まれるブックマークをすべて「投稿済み」として記録するだけで投稿しません（過去分が一気に流れるのを防ぐため）。以降の実行から新しいブックマークが投稿されます。

## 動作の詳細

- 投稿本文が Bluesky の300書記素制限を超える場合、ハッシュタグを末尾から削って収めます
- OGP 画像が取得できない・1MB を超える場合は画像なしのリンクカードになります
- 投稿に失敗したブックマークは次回の実行で自動的にリトライされます
- ブックマークの削除・コメント編集には追従しません（投稿は一度きり）

## 開発

```bash
npm test           # ユニットテスト
npm run typecheck  # 型チェック
npm run dev        # ローカル実行（別ターミナルから下記でトリガー）
# curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

設計ドキュメント: [docs/superpowers/specs/2026-07-09-hatebusky-design.md](docs/superpowers/specs/2026-07-09-hatebusky-design.md)
````

- [ ] **Step 2: 最終検証**

```bash
npm run typecheck && npm test
```

期待: 型エラーなし、全18テスト PASS。

- [ ] **Step 3: コミット**

```bash
git add README.md
git commit -m "docs: add Japanese README with self-hosting instructions"
```

- [ ] **Step 4: 実デプロイ（ユーザー操作）**

実際の Cloudflare へのデプロイと Bluesky シークレット設定はユーザーのアカウント操作を伴うため、README の手順に沿ってユーザーと一緒に行う（KV 作成 → `wrangler.toml` に id 反映 → secret 設定 → `DRY_RUN=true` でデプロイして1サイクル観察 → `DRY_RUN=false` に戻して本稼働）。
