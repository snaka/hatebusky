# hatebusky ロードマップ

今後の改善候補を優先度つきで記録する。着手時はこのファイルの該当項目を消すか「済」を付けること。
初版: 2026-07-09（v1 本稼働開始時点。最終レビューで Minor 判定された follow-up と、設計時にスコープ外とした機能を集約）

## 運用改善

### Observability（永続ログ）の有効化 — 優先度: 高・工数: 数分

現状ログは `wrangler tail` かダッシュボードの Live logs でしか見られず、過去分を遡れない。
`wrangler.toml` に以下を追加して再デプロイするだけで、無料枠（20万イベント/日・3日保持）で
ダッシュボードから過去の cron 実行ログを検索できるようになる。

```toml
[observability]
enabled = true
```

### 連続失敗の検知 — 優先度: 中

現在、投稿失敗は次回 cron のリトライ任せで、恒久的な失敗（アプリパスワード失効・
はてなのフィード仕様変更など）に気づく手段がない。案:

- 失敗回数を KV（例: `failcount:<url>`）に記録し、閾値超過でログレベルを上げる／該当URLをスキップする
- Cloudflare の Workers アラート、または Email Sending で通知する

## 機能追加（設計時にスコープ外としたもの）

### CLI ランナー — 優先度: 中

`src/core/` はプラットフォーム非依存の純粋関数として設計してあるため、
Node.js の CLI（cron/launchd 実行、状態は JSON ファイル）を `src/cli.ts` として
追加するだけで Cloudflare なしでも動かせる。セルフホストの選択肢が広がる。

### タグによる包含/除外フィルタ — 優先度: 中

「特定タグ付きだけ投稿」「`nopost` タグ付きは除外」を vars（例:
`INCLUDE_TAGS` / `EXCLUDE_TAGS`、カンマ区切り）で設定可能にする。
実装位置は `selectUnposted` の手前に純粋なフィルタ関数を足すのが素直。

### 非公開ブックマーク対応 — 優先度: 低

はてな OAuth（コンシューマキー申請が必要）とブックマーク REST API が必要になり、
認証情報管理も増える。公開ブクマ運用で困ってから検討する。

### ブックマーク削除・コメント編集への追従 — 優先度: 低

投稿は一度きりが現仕様。追従するなら KV に投稿 URI（`at://` URI）を保存し、
フィードとの差分で deletePost / 再投稿する設計になる。複雑さに見合うか要検討。

## コード品質 follow-up（最終レビューで Minor 判定・動作には支障なし）

### OGP 抽出の正規表現強化 — `src/core/ogp.ts`

- 属性名が単語境界で括られていない: `<meta data-content="X" property="og:title" content="Y">`
  で `data-content` の値を拾う。`(?:^|\s)` ガードを追加する
- `META_TAG_RE` が引用符内の `>` でタグを打ち切る（実害はフォールバックで吸収）
- `decodeEntities` が `&#x27;`（16進アポストロフィ）を扱わない
- `og:title` が空文字のとき `??` ではフォールバックしない（`src/worker.ts` の
  `ogp.title ?? bookmark.title`）。抽出側で空文字を `undefined` 扱いにするのが綺麗
- OGP の content-type 判定が `text/html` のみで `application/xhtml+xml` を落とす
  （`src/worker.ts` の `buildEmbed`）
- charset 宣言が一切ないレガシーページは UTF-8 デコードのまま（ヘッダ→meta→UTF-8 の
  フォールバック済み。さらにやるなら先頭バイトの推定だが、費用対効果は低い）

### ハッシュタグの記号処理 — `src/core/post-builder.ts`

`toHashtag` は空白除去のみで記号を落とさない。タグ `C++` → 本文 `#C++` になるが、
Bluesky の facet 検出は `#C` までしかタグとして認識しない。記号を除去 or 置換する
正規化を検討（どこまで削るかは要判断。日本語タグは現状問題なし）。

### その他小粒

- `src/core/select.ts`: ISO 日時文字列の比較に `localeCompare` を使っている。
  実害はないが、ロケール非依存のコードポイント比較（`a < b ? -1 : ...`）へ
- `test/feed.test.ts`: `dc:subject` が1個だけ／item が1個だけのフィクスチャがない
  （`isArray` オプションで構造的に正しいが、テストで固定しておくと安心）
- `test/post-builder.test.ts`: ちょうど300書記素の境界ケースのテストがない
- `package.json`: `npm init -y` の boilerplate が残っている
  （`"main": "index.js"`、`"private": "true"`（文字列）、空の description など）

## 参考

- 設計: [superpowers/specs/2026-07-09-hatebusky-design.md](superpowers/specs/2026-07-09-hatebusky-design.md)
- 実装計画: [superpowers/plans/2026-07-09-hatebusky.md](superpowers/plans/2026-07-09-hatebusky.md)
- 各項目の出所（タスクごとのレビュー記録）: `.superpowers/sdd/progress.md`（gitignore 対象のローカルファイル）
