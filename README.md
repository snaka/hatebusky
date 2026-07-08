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

ローカル実行にはダミー値で構わないので、`.dev.vars` に `BLUESKY_IDENTIFIER` / `BLUESKY_APP_PASSWORD` を書いてください。実際の投稿や KV への初回化書き込みを避けるため、`npx wrangler dev --test-scheduled --var DRY_RUN:true` のように `DRY_RUN` を有効にして試すのがおすすめです。

```bash
npm test           # ユニットテスト
npm run typecheck  # 型チェック
npm run dev        # ローカル実行（別ターミナルから下記でトリガー）
# curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

設計ドキュメント: [docs/superpowers/specs/2026-07-09-hatebusky-design.md](docs/superpowers/specs/2026-07-09-hatebusky-design.md)
今後の改善候補: [docs/ROADMAP.md](docs/ROADMAP.md)
