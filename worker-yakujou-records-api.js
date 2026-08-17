/**
 * yakujou-records-api Cloudflare Worker
 *
 * 薬情(薬剤情報提供書)の読み取り結果を、利用者ごとにD1(shiten-toggo-db)の
 * yakujou_records テーブルへ保存するためのAPI。
 *
 * 事前準備:
 * 1. このコードを Cloudflare Workers の「yakujou-records-api」にQuick Editで貼り付けて保存
 * 2. 「バインディング」タブで D1 データベースを追加
 *    - 変数名: DB
 *    - データベース: shiten-toggo-db
 * 3. 「設定」タブの「変数とシークレット」で以下を追加
 *    - WRITE_SECRET: このAPIを呼び出すための合言葉(好きな文字列)
 * 4. 「デプロイ」を押す
 *
 * yakujou_records テーブルは以下のSQLで作成済み:
 * CREATE TABLE IF NOT EXISTS yakujou_records (
 *   id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   created_at TEXT NOT NULL,
 *   riyousha_name TEXT NOT NULL,
 *   hakko_bi TEXT,
 *   yakkyoku_mei TEXT,
 *   kusuri_ichiran TEXT,
 *   yomitori_biko TEXT
 * );
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
      });
    }

    const authHeader = request.headers.get('Authorization');
    if (authHeader !== ('Bearer ' + env.WRITE_SECRET)) {
      return new Response(JSON.stringify({ error: '認証エラーです' }), {
        status: 401,
        headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
      });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'JSON形式が正しくありません' }), {
        status: 400,
        headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
      });
    }

    const riyoushaName = body.riyousha_name;
    if (!riyoushaName) {
      return new Response(JSON.stringify({ error: '利用者名(riyousha_name)が必要です' }), {
        status: 400,
        headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
      });
    }

    const createdAt = new Date().toISOString();
    const kusuriJson = JSON.stringify(body.kusuri_ichiran || []);

    try {
      await env.DB.prepare(
        'INSERT INTO yakujou_records (created_at, riyousha_name, hakko_bi, yakkyoku_mei, kusuri_ichiran, yomitori_biko) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(
        createdAt,
        riyoushaName,
        body.hakko_bi || null,
        body.yakkyoku_mei || null,
        kusuriJson,
        body.yomitori_biko || null
      ).run();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'DB書き込みエラー: ' + e.message }), {
        status: 500,
        headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
    });
  }
};
