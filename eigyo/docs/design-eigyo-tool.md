# 設計書: ノーサイト企業 営業ツール（リサーチ→サンプル→アプローチ）

## 1. 目的と要件

### 何を実現するか
「Webサイトを持っていない（または貧弱な）ローカル企業・店舗」を見つけ、
その会社向けのサンプルLPを自動生成し、営業メール文面まで作る公開Webアプリ。
元ネタ: 海外の高校生がGoogleマップでサイトなし企業を探し、サンプルを作ってメール営業した事例。

### 機能要件
1. **リサーチ**: エリア＋業種を入力すると、該当企業リストを取得。各社について
   - 事業内容 / 規模感
   - 公開連絡先（メール・電話・SNS・問い合わせフォームURL）
   - Webサイトの有無と品質評価（なし / SNSのみ / 古い・低品質 / 十分）
   - 「攻略対象」フラグ（サイトなし〜低品質）
2. **サンプルLP生成**: 対象1社を選ぶと、その企業向けの完成した1ファイルHTMLのLPを生成（ヒーロー / サービス / 実績 / お客様の声プレースホルダ / 問い合わせ）。プレビュー＋ダウンロード。
3. **営業メール生成**: 件名＋本文。具体的な言及→サイトがない指摘→サンプルの提示→やわらかいCTA。チャネル（メール / Instagram DM / 問い合わせフォーム）とトーンを選択。
4. **フォローアップ案**: 返信がない場合の2通目、想定反論への返し。
5. **設定の保存**: 自分の情報（名前・屋号・提供サービス・料金感・ポートフォリオURL・署名）、APIキー、生成済みの見込み客と成果物を localStorage に保存。
6. **言語**: 日本語 / 英語 切り替え（出力言語）。

### 非機能要件
- **完全静的**: 単一 `index.html`（CSS/JS インライン）。GitHub Pages にそのまま置ける。ビルド不要。
- **APIキー**: ユーザーが自分の Anthropic APIキーを入力、localStorage 保存。サーバーに送らない（Anthropic API へ直接 fetch）。
- **セキュリティ表示**: 「キーはこのブラウザにのみ保存」と明示。共有PC警告。
- コスト概算の表示（呼び出しごとの usage → 概算ドル）。

## 2. 現状分析
- 新規プロジェクト。既存コードなし。
- 配置先候補: 新規 GitHub リポジトリ（`watashi-no-todo` と同様に GitHub Pages 公開）。
- 参考: 既存の todo アプリが GitHub Pages 単一ファイル構成で運用中。

## 3. アーキテクチャ設計

```
┌─────────────────────────────────────────────┐
│  index.html (SPA, vanilla JS)               │
│                                             │
│  [設定パネル]  APIキー / 自分の情報 / 言語   │
│      │ localStorage                          │
│      ▼                                       │
│  [リサーチ画面] エリア・業種 → 実行          │
│      │                                       │
│      ▼   fetch → api.anthropic.com/v1/messages
│  ┌──────────────────────────────┐           │
│  │ Claude (claude-sonnet-5)     │           │
│  │  + web_search_20260209 tool  │           │
│  │  → JSON: prospects[]         │           │
│  └──────────────────────────────┘           │
│      │                                       │
│      ▼                                       │
│  [見込み客リスト]  表形式・攻略対象フラグ    │
│      │ 「この会社を攻略」                     │
│      ▼                                       │
│  ┌──────────────────────────────┐           │
│  │ Claude 呼び出し #2            │           │
│  │  → { email, followups, LP_html } │        │
│  └──────────────────────────────┘           │
│      │                                       │
│      ▼                                       │
│  [成果物画面] メール(コピー) / LP(プレビュー・DL) │
└─────────────────────────────────────────────┘
```

### データフロー
1. 設定 → localStorage（`eigyo.settings`, `eigyo.apiKey`）
2. リサーチ実行 → Claude(#1, web_search) → `prospects[]` を `eigyo.prospects` に保存
3. 攻略 → Claude(#2) → `eigyo.assets[prospectId]` に保存
4. すべてクライアント内で完結。再訪時は localStorage から復元。

### pause_turn 対応
web_search はサーバー側ループ。`stop_reason === "pause_turn"` の場合は
`messages` に response.content を積んで同じリクエストを再送する簡易ループ（最大5回）。

## 4. データモデル

```js
// localStorage: eigyo.settings
{
  lang: "ja" | "en",
  model: "claude-sonnet-5" | "claude-opus-5",
  me: {
    name, brand, services,      // 例: "小規模店向けの1ページLP制作"
    priceNote,                  // 例: "初期5万円〜 / 月5千円"
    portfolioUrl, signature
  }
}

// localStorage: eigyo.apiKey  (文字列, 別キー)

// localStorage: eigyo.prospects  → Prospect[]
Prospect {
  id,                 // crypto.randomUUID()
  name, category, area,
  summary,            // 事業内容の要約
  contact: { email, phone, instagram, form_url, other },
  website: { url|null, status: "none"|"social_only"|"outdated"|"ok", note },
  isTarget: boolean,  // status !== "ok"
  sources: string[],  // 参照URL
  createdAt
}

// localStorage: eigyo.assets  → { [prospectId]: Asset }
Asset {
  email: { subject, body },
  dm: { text },
  followups: [{ label, body }],
  objections: [{ q, a }],
  lpHtml: string,     // 完全な単一ファイルHTML
  createdAt
}
```

### バリデーション
- APIキー: 空なら実行不可、`sk-ant-` プレフィックスを軽くチェック（警告のみ）。
- エリア・業種: 両方必須。
- Claude 応答: ```json フェンス除去 → `JSON.parse`。失敗時はraw表示＋リトライ。

## 5. API設計（Anthropic Messages API 直叩き）

エンドポイント: `POST https://api.anthropic.com/v1/messages`

ヘッダー:
```
content-type: application/json
x-api-key: <ユーザーのキー>
anthropic-version: 2023-06-01
anthropic-dangerous-direct-browser-access: true
```

### 呼び出し#1 リサーチ
```jsonc
{
  "model": "claude-sonnet-5",
  "max_tokens": 8000,
  "tools": [{ "type": "web_search_20260209", "name": "web_search", "max_uses": 8 }],
  "system": "<リサーチャー指示 + 出力JSONスキーマ + 言語>",
  "messages": [{ "role": "user", "content": "エリア: <>, 業種: <>, 件数: 最大12" }]
}
```
最終アシスタントテキストは prospects[] の JSON のみ。

### 呼び出し#2 成果物生成
```jsonc
{
  "model": "<settings.model>",
  "max_tokens": 16000,
  "system": "<コピーライター兼Web制作者。自分の情報。出力JSON: {email, dm, followups, objections, lpHtml}。lpHtmlは<!doctype html>から始まる完全なファイル。>",
  "messages": [{ "role": "user", "content": "<Prospect の JSON>" }]
}
```

### エラーレスポンス処理
| HTTP | 表示 |
|---|---|
| 401 | 「APIキーが無効です」→ 設定を開く |
| 429 | 「レート制限。少し待って再試行」＋自動リトライ1回（`retry-after`） |
| 400 | エラーメッセージ本文を表示 |
| 5xx / network | 「接続失敗。再試行」 |
| `stop_reason: "refusal"` | 内容を表示し中断 |

## 6. ファイル構成（既存 ncbc リポジトリ内のサブフォルダ）
- 新規 `eigyo/index.html` — アプリ本体（HTML+CSS+JS インライン）
- 新規 `eigyo/README.md` — 使い方 / 免責
- 新規 `eigyo/docs/design-eigyo-tool.md` — 本設計書
- 既存 Todo アプリ（リポジトリ root の `index.html`）はそのまま。営業ツールは `eigyo/` 配下。
- 公開URL: https://masato19870410.github.io/ncbc/eigyo/ （NoCodeBootCamp 成果物）

## 7. 実装手順
1. `index.html` 骨組み: レイアウト（設定 / リサーチ / リスト / 成果物 のタブ）、CSSトークン、ダーク対応。
2. localStorage ラッパ（get/set/JSON）＋設定フォームの読み書き。
3. Anthropic fetch ラッパ（ヘッダー、エラー整形、pause_turn ループ、usage集計）。
4. リサーチ機能: フォーム → 呼び出し#1 → JSON パース → prospects 描画・保存。
5. 見込み客リスト UI: 表、攻略対象フィルタ、削除、CSVエクスポート。
6. 成果物生成: 「攻略」→ 呼び出し#2 → メール/DM/フォローアップ表示、コピー、LPプレビュー(iframe srcdoc)＋ダウンロード。
7. コスト概算表示、トースト通知、空状態。
8. README、ローカル動作確認（ブラウザ）、デザイン微調整。
9. デプロイ（別途相談）。

各ステップ後にブラウザ（in-app）で表示崩れ・JSエラーを確認。

## 8. エッジケースとエラーハンドリング
- APIキー未設定で実行 → モーダルで設定へ誘導。
- web_search が対象を見つけられない → 空リスト＋「エリア/業種を具体的に」ヒント、手動追加フォールバック。
- Claude が JSON 以外を返す → フェンス除去で再パース、それでも失敗ならraw＋「再生成」。
- 連絡先が取得できない企業 → `contact` 空でも表示、「電話のみ」等を明記。
- LP HTML が巨大 → iframe srcdoc プレビュー、`Blob` でダウンロード。
- localStorage 上限 → 保存失敗を検知し「古い見込み客を削除して」と通知。
- 共有/公開PC → 起動時に「キーはこの端末に保存。共有PCでは使わない」注意書き。
- レート制限・高コスト → 1回の概算コストを実行前に表示、件数上限12。

### 営業倫理・法務（README とアプリ内注記）
- スパム送信は各国法（特定電子メール法 / CAN-SPAM / GDPR）に注意、と明記。
- 公開されている連絡先のみ利用。無差別大量送信はしない。
- 生成メールは下書き。送信は必ず人間が確認。

## 9. テスト戦略
- **手動E2E**（実キー）: リサーチ→リスト→攻略→LP DL の一連。
- JSON パース: フェンスあり/なし/前後テキストあり のサンプルで確認。
- エラー系: 無効キー(401)、業種空、オフラインを再現。
- localStorage: 復元、上限、クリア。
- 表示: ライト/ダーク、モバイル幅、LP プレビューのスクロール。
- 自動テストは持たない（単一HTML・外部API依存のため手動中心）。
```
