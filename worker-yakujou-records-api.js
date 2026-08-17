/**
 * yakujou-records-api Cloudflare Worker
 *
 * 指示書・介護保険証・介護負担割合証・薬情など、読み取った書類の内容を
 * 書類の種類を問わない共通のD1(shiten-toggo-db)の document_records テーブルへ保存する。
 * あわせて、撮影した原本写真をR2(care-document-photos)へ保存し、そのキーをD1に記録する。
 *
 * 名前は「yakujou-records-api」のままだが、薬情専用ではなく全書類共通のAPI。
 * care-document-photosも同様に、将来ケアプラン・看護サマリー・診療情報提供書など
 * 他の書類の写真も一緒に入れる想定の共有バケット。
 * 書類の種類ごとに doc_type をキーの先頭フォルダ名として振り分ける
 * (例: yakujou/xxx.jpg, shijisho/xxx.jpg, careplan/xxx.jpg)。
 *
 * 事前準備:
 * 1. R2バケット「care-document-photos」を作成
 * 2. このコードを Cloudflare Workers の「yakujou-records-api」にQuick Editで貼り付けて保存
 * 3. 「バインディング」タブで追加
 *    - D1データベース: 変数名 DB → shiten-toggo-db
 *    - R2バケット: 変数名 PHOTOS → care-document-photos
 * 4. 「設定」の「変数とシークレット」に以下を追加(既にあれば流用)
 *    - WRITE_SECRET: 保存(POST /)・写真取得(/photo)用の合言葉
 *    - READ_SECRET: 期限アラート(/alerts)専用の、書き込み権限を持たない合言葉。
 *      外部システム(看護ポータル等)にはこちらだけを渡す(WRITE_SECRETは渡さない)
 * 5. D1コンソール(shiten-toggo-db)で以下を実行してテーブルを作成:
 *    CREATE TABLE IF NOT EXISTS document_records (
 *      id INTEGER PRIMARY KEY AUTOINCREMENT,
 *      created_at TEXT NOT NULL,
 *      doc_type TEXT NOT NULL,
 *      riyousha_name TEXT NOT NULL,
 *      extracted_json TEXT,
 *      photo_key TEXT
 *    );
 *    (旧yakujou_recordsテーブルはテスト用の2件のみで、今後は使わない。
 *     残しておいても害はないので、削除は任意)
 * 6. 「デプロイ」を押す
 *
 * エンドポイント:
 * POST /            … 書類データ(+写真)を保存(要 WRITE_SECRET)
 * GET  /photo?key=… … 保存された写真を取得(要 WRITE_SECRET)
 * GET  /alerts      … 指示書・介護保険証・介護負担割合証の期限アラート一覧を取得
 *                      (要 READ_SECRET。他システム(看護ポータル等)へのデータ
 *                      提供用の読み取り専用エンドポイント)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
  });
}

function isAuthed(request, env) {
  const authHeader = request.headers.get('Authorization');
  return authHeader === ('Bearer ' + env.WRITE_SECRET);
}

// /alerts専用の認証。書き込み権限は与えず、READ_SECRETのみで通す。
function isReadAuthed(request, env) {
  const authHeader = request.headers.get('Authorization');
  return authHeader === ('Bearer ' + env.READ_SECRET);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function handleSave(request, env) {
  if (!isAuthed(request, env)) {
    return jsonResponse({ error: '認証エラーです' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'JSON形式が正しくありません' }, 400);
  }

  const riyoushaName = body.riyousha_name;
  if (!riyoushaName) {
    return jsonResponse({ error: '利用者名(riyousha_name)が必要です' }, 400);
  }
  const docType = body.doc_type || 'other';

  const createdAt = new Date().toISOString();
  const extractedJson = JSON.stringify(body.extracted_fields || {});

  let photoKey = null;
  if (body.photo_base64) {
    try {
      const bytes = base64ToBytes(body.photo_base64);
      const ext = (body.photo_mime === 'image/png') ? 'png' : 'jpg';
      const docTypeFolder = docType.replace(/[^a-zA-Z0-9_-]/g, '') || 'other';
      photoKey = docTypeFolder + '/' + createdAt.replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      await env.PHOTOS.put(photoKey, bytes, {
        httpMetadata: { contentType: body.photo_mime || 'image/jpeg' }
      });
    } catch (e) {
      return jsonResponse({ error: '写真の保存に失敗しました: ' + e.message }, 500);
    }
  }

  try {
    await env.DB.prepare(
      'INSERT INTO document_records (created_at, doc_type, riyousha_name, extracted_json, photo_key) VALUES (?, ?, ?, ?, ?)'
    ).bind(
      createdAt,
      docType,
      riyoushaName,
      extractedJson,
      photoKey
    ).run();
  } catch (e) {
    return jsonResponse({ error: 'DB書き込みエラー: ' + e.message }, 500);
  }

  return jsonResponse({ ok: true, photo_saved: !!photoKey });
}

// 書類の種類ごとに、期限として扱う項目名(getDocConfigのスキーマのキー名と対応)。
// yakujou(薬情)には期限に相当する項目がないため対象外。
const EXPIRY_FIELD_BY_DOC_TYPE = {
  shijisho: 'yuukou_shuuryou',
  hokensho: 'nintei_yuukou_shuuryou',
  futanwariai: 'tekiyou_shuuryou'
};

async function handleGetAlerts(request, env) {
  if (!isReadAuthed(request, env)) {
    return jsonResponse({ error: '認証エラーです' }, 401);
  }

  const docTypes = Object.keys(EXPIRY_FIELD_BY_DOC_TYPE);
  const placeholders = docTypes.map(function () { return '?'; }).join(',');

  let rows;
  try {
    const result = await env.DB.prepare(
      'SELECT riyousha_name, doc_type, extracted_json, created_at FROM document_records ' +
      'WHERE doc_type IN (' + placeholders + ') ORDER BY created_at DESC'
    ).bind(...docTypes).all();
    rows = result.results || [];
  } catch (e) {
    return jsonResponse({ error: 'DB読み取りエラー: ' + e.message }, 500);
  }

  // riyousha_name(手入力の氏名)+doc_type ごとに、一番新しい行だけを採用する
  // (created_at DESCで取得しているので、最初に出てきたものが最新)。
  const seen = {};
  const todayMs = Date.now();
  const alerts = [];

  rows.forEach(function (row) {
    const key = row.riyousha_name + '|' + row.doc_type;
    if (seen[key]) return;
    seen[key] = true;

    const expiryField = EXPIRY_FIELD_BY_DOC_TYPE[row.doc_type];
    let extracted;
    try {
      extracted = JSON.parse(row.extracted_json || '{}');
    } catch (e) {
      return;
    }
    const validUntil = extracted[expiryField];
    if (!validUntil) return;

    const expiryMs = Date.parse(validUntil);
    if (isNaN(expiryMs)) return;

    const daysRemaining = Math.floor((expiryMs - todayMs) / 86400000);
    const status = daysRemaining < 0 ? 'red' : (daysRemaining <= 14 ? 'yellow' : 'green');

    alerts.push({
      riyousha_name: row.riyousha_name,
      doc_type: row.doc_type,
      valid_until: validUntil,
      days_remaining: daysRemaining,
      status: status,
      recorded_at: row.created_at
    });
  });

  alerts.sort(function (a, b) { return a.days_remaining - b.days_remaining; });

  return jsonResponse({ alerts: alerts });
}

async function handleGetPhoto(request, env) {
  if (!isAuthed(request, env)) {
    return jsonResponse({ error: '認証エラーです' }, 401);
  }
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) {
    return jsonResponse({ error: 'key指定が必要です' }, 400);
  }
  const obj = await env.PHOTOS.get(key);
  if (!obj) {
    return jsonResponse({ error: '写真が見つかりません' }, 404);
  }
  return new Response(obj.body, {
    headers: Object.assign({
      'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg',
      'Cache-Control': 'private, max-age=3600'
    }, CORS_HEADERS)
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/photo') {
      return handleGetPhoto(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/alerts') {
      return handleGetAlerts(request, env);
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed' }, 405);
    }
    return handleSave(request, env);
  }
};
