# 営業AI v4（Googleシート直読み版）

`eigyo3.5/` をベースに、データ取得元を静的JSON(`data/prospects.json`)からGoogleスプレッドシートの直読みに変更したバージョン。UI・CSS・チェックリスト表示ロジックはeigyo3.5からそのまま流用している。Supabase/GASは使わない(旧eigyo2.5でSupabase無料枠の自動一時停止により公開ページが真っ白になった実績があるため、意図的に避けている)。

## 位置付け

地方の中小企業へ採用サイトやホームページ改善を提案する、小規模な制作会社・個人事業主向けの営業仮説整理ツール。会社情報を保存するCRMではなく、営業開始前に公開情報を同じ形式で比較し、「次に誰へ、何を、なぜ提案するか」を決める用途に絞っている。

- 実行時に生成AIへ問い合わせる処理はない。公開情報と事前に定義したルールによる支援であり、AIが正解を判断するアプリとは説明しない。
- 表示金額は求人給与や業界平均から計算した参考額であり、実際の削減額・増収額・ROIではない。
- SalesforceやHubSpotのような営業活動全体を管理するCRMの代替ではない。営業前の地域企業調査と提案仮説の比較に特化している。
- 確認済み・外部情報からの推定・未確認を区別し、出典と確認日を詳細画面に表示する。

## 対象シート

- シート名: 「営業リサーチ v3 - prospects」
- シートID: `1OmKyrwSlLxOEPetl5Q17Aox05Ata8FHMxhDEYgtDkX4`
- シートURL: https://docs.google.com/spreadsheets/d/1OmKyrwSlLxOEPetl5Q17Aox05Ata8FHMxhDEYgtDkX4/edit

## データの列構成(ヘッダー行)

`data/prospects_seed.csv` と同じ列をシートの1行目に用意すること。

```
name, category, industry, area, phone, email, dept, summary,
hypothesis_sales, hypothesis_hr, hypothesis_pr, proposal, message, script,
lat, lng, channels_json, source_preset, verified_at, capital_man, revenue_man
```

- `channels_json` は `[{"n":チャネル名, "r":評価(◎○△✕), "u":実URLまたはnull, "m":根拠メモ}, ...]` のJSON文字列をそのまま1セルに入れる(カンマや引用符を含むのでCSVとしては通常どおりダブルクォートで囲まれる形でよい)。
- `dept` は `営業` / `人事` / `広報` のいずれか。カード本文に出す主要文(`hypothesisSales`/`hypothesisHr`/`hypothesisPr`のどれを見せるか)の切り替えに使う。
- `capital_man` は資本金を万円単位で、`revenue_man` は年間売上高を万円単位で入れる。未確認の場合は空欄にする。

## ★ユーザー作業が必要な手順★

このエージェントからは自動化できないため、以下は本人が手動で行うこと。

### 1. シートに初期データを反映する

`data/prospects_seed.csv` は、`eigyo3.5/data/prospects.json`(実際に裏取り済みの企業情報)をそのままCSVに変換したもの。これをGoogleスプレッドシート「営業リサーチ v3 - prospects」に貼り付ける(またはCSVとしてインポートする)。

- スプレッドシートを開く → 既存シートが空、またはこの初期データで置き換えたい場合は `data/prospects_seed.csv` の内容をコピーしてシートに貼り付け
- 既にシートにデータが入っている場合は、列構成が上記と合っているか確認してから使う

### 2. シートを「ウェブに公開」する

1. Googleスプレッドシートを開く
2. 「ファイル」→「共有」→「ウェブに公開」
3. 公開する範囲で対象のシート(タブ)を選択し、形式を「カンマ区切り値(.csv)」に設定
4. 「公開」をクリック
5. 表示されたURLをコピーする(形式は `https://docs.google.com/spreadsheets/d/<シートID>/pub?gid=<gid>&single=true&output=csv` のようなものになる)

これにより、認証不要でCSVをそのままfetchできるようになる(GAS/APIキー不要)。

### 3. `index.html` にCSV URLを設定する

`index.html` 内の以下の行を、手順2で取得したURLに書き換える。

```js
const SHEET_CSV_URL = "__SET_SHEET_CSV_URL_HERE__";
```

例:

```js
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1OmKyrwSlLxOEPetl5Q17Aox05Ata8FHMxhDEYgtDkX4/pub?gid=0&single=true&output=csv";
```

(「ウェブに公開」ではなく通常の `export?format=csv&gid=0` 形式のエクスポートURLでも、シートの共有設定が「リンクを知っている全員が閲覧可」になっていればそのまま使えることがあるが、確実に動かすには「ウェブに公開」を推奨)

### 4. 表示確認

ローカルで `python3 -m http.server` などを立てて `eigyo4/index.html` を開き、カード一覧が正しく表示されるか確認する。SHEET_CSV_URL未設定のままだとエラーメッセージが表示される(想定どおりの挙動)。

### 5. 公開

GitHub Pagesで公開する場合、他バージョン同様 `https://masato19870410.github.io/ncbc/eigyo4/` でアクセスできるようになる(リポジトリ側の設定変更は不要、既存のPages配信設定がそのまま有効)。

## eigyo3.5との違い

| 項目 | eigyo3.5 | eigyo4 |
|---|---|---|
| データ取得元 | `./data/prospects.json`(静的JSON、リポジトリにコミット) | Googleスプレッドシートの公開CSV(fetch) |
| データ更新方法 | JSONファイルを編集してgit commit | スプレッドシートを直接編集するだけ(デプロイ不要) |
| 外部サービス依存 | なし | Googleスプレッドシート(「ウェブに公開」のみ、API/GAS不要) |
| UI/CSS/チェックリストロジック | — | eigyo3.5から変更なし |

## 既知の制約

- 「ウェブに公開」設定後もGoogle側のキャッシュにより、シート編集の反映が数分遅れることがある。
- シートの列順・列名を変えるとパースに失敗するので、列構成は上記のヘッダーに固定すること。
- `channels_json`セルの中身が壊れている(JSONとして不正)行は、その行だけチャンネル一覧が空になる(カード自体は表示される)。
- 公開情報は更新・削除されるため、提案前に公式サイト・求人票・電話で再確認する必要がある。
- 人材紹介手数料を用いた金額は「将来、人材紹介を利用する場合の費用リスク」の参考額であり、採用サイト制作による削減効果を保証しない。
- 公式情報との不一致を確認した企業はスプレッドシート側を更新し、`applyVerifiedOverrides()`でも公開キャッシュ反映までの表示を補正する。
