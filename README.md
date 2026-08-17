# 帳票AI読取アプリ(お試し版)

訪問看護指示書・介護保険証・介護負担割合証・薬情(薬剤情報提供書)を、スマホで撮影 → AIが自動判定・文字起こし → 内容確認 → 保存、まで行う社内ツールです。

- 公開URL: https://yst-nakamura.github.io/shijisho-check-app/
- 看護ポータルサイトとの連携仕様は [連携仕様書_看護ポータル向け.md](./連携仕様書_看護ポータル向け.md) を参照してください。

## できること

1. 📷カメラ撮影 / 🖼アルバム・PDF選択
2. 書類の種類を選ばなくても、AIが内容を見て自動判定(指示書／介護保険証／介護負担割合証／薬情)
3. AIが項目ごとに文字起こし → 画面で内容を確認・修正
4. 指示書・介護保険証・介護負担割合証は、社内システム「KANTAKI-WIZ」にワンクリックで自動入力(ブックマークレット使用)
5. すべての書類種別で、内容と撮影写真をCloudflare D1/R2に保存(利用者ごとの記録として蓄積)

## 構成ファイル

| ファイル | 役割 |
|---|---|
| `index.html` | フロントエンド本体(単一HTMLファイル。GitHub Pagesで公開) |
| `gas/Code.gs` | バックエンド(Google Apps Script)。OpenAIへの読み取りリクエスト中継、D1保存の中継、合言葉によるアクセス制御 |
| `bookmarklet.js` / `bookmarklet-minified.txt` | KANTAKI-WIZへの自動入力用ブックマークレット(平文版／貼り付け用の圧縮版) |
| `worker-yakujou-records-api.js` | Cloudflare Worker。D1(`document_records`テーブル)への保存、R2(`care-document-photos`)への写真保存、期限アラートAPI(`/alerts`)を提供 |
| `連携仕様書_看護ポータル向け.md` | 他システム(看護ポータル等)がこのアプリのデータを読み取るためのAPI仕様書 |
| `使い方ガイド.pptx` | 現場スタッフ向けの操作手順(指示書のKANTAKI-WIZ自動入力フロー) |

## 全体構成

```
[スマホ/PC ブラウザ]
      │  (写真+書類種別)
      ▼
[index.html] ──POST──▶ [GAS: Code.gs] ──▶ [openai-proxy Worker] ──▶ [OpenAI Responses API]
      │                        │
      │                        └─ action=save_document の場合
      │                              │
      │                              ▼
      │                     [yakujou-records-api Worker]
      │                              │        │
      │                              ▼        ▼
      │                       [D1: document_records]  [R2: care-document-photos]
      │
      └─ KANTAKI-WIZ用にコピー → [bookmarklet.js] → KANTAKI-WIZ画面に自動入力
```

## セットアップ(自分で複製・移設する場合)

1. **GAS**: `gas/Code.gs`を新規Apps Scriptプロジェクトに貼り付け、スクリプトプロパティに`TEAM_SECRET`(openai-proxy用)・`APP_PASSCODE`(アプリの合言葉)・`YAKUJOU_WRITE_SECRET`(下記Workerと共通)を設定し、ウェブアプリとしてデプロイ(アクセス:全員)
2. **Cloudflare Worker**: `worker-yakujou-records-api.js`を「yakujou-records-api」という名前のWorkerに貼り付け、D1バインディング(`DB`→`shiten-toggo-db`)・R2バインディング(`PHOTOS`→`care-document-photos`)、環境変数`WRITE_SECRET`・`READ_SECRET`を設定してデプロイ
3. **D1テーブル**: `document_records`テーブルを作成(SQLはWorkerファイル冒頭のコメント参照)
4. **index.html**: 「設定」欄にGASのウェブアプリURLと合言葉を入力(ブラウザのlocalStorageに保存される)

## 注意事項

- 個人情報(利用者名・生年月日・要介護度等)はコードやコミットにハードコードしていません
- 合言葉・APIキーの類はすべてCloudflare/GASの環境変数(スクリプトプロパティ)で管理しており、このリポジトリには含まれていません
