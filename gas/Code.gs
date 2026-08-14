/**
 * 指示書AI読取(お試し版) - GASバックエンド (社内openai-proxy経由版)
 *
 * 社内のCloudflare Worker「openai-proxy」がOpenAIキーを保持し、
 * TEAM_SECRET(合言葉)で認証したリクエストだけをOpenAIへ中継してくれる。
 * そのため、このスクリプトはOpenAIキーを直接持たず、TEAM_SECRETだけを持つ。
 *
 * 事前準備:
 * 1. このプロジェクトを Apps Script (script.google.com) の新規プロジェクトに貼り付ける
 * 2. 「プロジェクトの設定」→「スクリプト プロパティ」で以下を設定する
 *    - TEAM_SECRET: openai-proxyの認証用シークレット(Tetsuyaさんに確認)
 *    - APP_PASSCODE: このアプリ用に社内で共有する合言葉(好きな文字列。TEAM_SECRETとは別物)
 * 3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *    - 実行するユーザー: 自分
 *    - アクセスできるユーザー: 全員(重要: 「組織内のみ」にするとアプリ側からの
 *      呼び出しがGoogleログイン画面にリダイレクトされてしまい動作しません。
 *      社内限定はAPP_PASSCODEで実現します)
 * 4. 発行されたウェブアプリURLを index.html の設定欄に貼り付ける
 */

var OPENAI_MODEL = 'gpt-5.6';
var OPENAI_API_URL = 'https://openai-proxy.tetsuya-nakamura-y.workers.dev/v1/responses';

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var imageBase64 = body.imageBase64;
    var mimeType = body.mimeType || 'image/jpeg';
    var passcode = body.passcode || '';
    var docType = body.docType || 'shijisho';

    var expectedPasscode = PropertiesService.getScriptProperties().getProperty('APP_PASSCODE');
    if (expectedPasscode && passcode !== expectedPasscode) {
      return jsonOutput({ error: '合言葉が正しくありません。設定を確認してください。' });
    }

    if (!imageBase64) {
      return jsonOutput({ error: '画像データがありません。' });
    }

    var teamSecret = PropertiesService.getScriptProperties().getProperty('TEAM_SECRET');
    if (!teamSecret) {
      return jsonOutput({ error: 'TEAM_SECRETが設定されていません。GASのスクリプトプロパティに、openai-proxy用のTEAM_SECRETを設定してください。' });
    }

    var config = getDocConfig(docType);
    var schema = config.schema;
    var instructionText = config.instructionText;

    var isPdf = (mimeType === 'application/pdf');
    var contentParts = isPdf
      ? [
          { type: 'input_file', file_data: 'data:application/pdf;base64,' + imageBase64, filename: 'shijisho.pdf' },
          { type: 'input_text', text: instructionText }
        ]
      : [
          { type: 'input_image', image_url: 'data:' + mimeType + ';base64,' + imageBase64 },
          { type: 'input_text', text: instructionText }
        ];

    var payload = {
      model: OPENAI_MODEL,
      input: [{
        type: 'message',
        role: 'user',
        content: contentParts
      }],
      text: {
        format: {
          type: 'json_schema',
          name: docType + '_extraction',
          strict: true,
          schema: schema
        }
      }
    };

    var response = UrlFetchApp.fetch(OPENAI_API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + teamSecret
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var statusCode = response.getResponseCode();
    var responseText = response.getContentText();

    if (statusCode !== 200) {
      return jsonOutput({ error: 'AIの呼び出しに失敗しました(' + statusCode + '): ' + responseText });
    }

    var result = JSON.parse(responseText);
    var textBlock = null;
    for (var i = 0; i < result.output.length; i++) {
      var outputItem = result.output[i];
      if (outputItem.type !== 'message') continue;
      for (var j = 0; j < outputItem.content.length; j++) {
        if (outputItem.content[j].type === 'output_text') {
          textBlock = outputItem.content[j].text;
          break;
        }
      }
      if (textBlock) break;
    }

    if (!textBlock) {
      return jsonOutput({ error: 'AIの応答からテキストを取得できませんでした。' });
    }

    var extracted = JSON.parse(textBlock);
    return jsonOutput({ ok: true, extracted: extracted });
  } catch (err) {
    return jsonOutput({ error: '処理中にエラーが発生しました: ' + err.message });
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 書類の種類ごとに、AIへ渡すJSON Schemaと指示文を組み立てる。
 * docType: 'shijisho'(既定) | 'hokensho' | 'futanwariai'
 */
function getDocConfig(docType) {
  var CONFIGS = {
    shijisho: {
      schema: {
        type: 'object',
        properties: {
          shiji_shurui: {
            type: ['string', 'null'],
            description: '指示書の種類。例: 訪問看護指示書, 特別訪問看護指示書, 精神科訪問看護指示書, 在宅患者訪問点滴注射指示書, リハビリテーション指示書, その他。判別できない場合はnull'
          },
          jigyousho_mei: { type: ['string', 'null'], description: 'この指示書の宛先となっている訪問看護ステーション(事業所)名' },
          iryoukikan_mei: { type: ['string', 'null'], description: '発行した医療機関名' },
          iryoukikan_shozaichi: { type: ['string', 'null'], description: '発行した医療機関の所在地(住所)' },
          iryoukikan_denwa: { type: ['string', 'null'], description: '発行した医療機関の電話番号' },
          iryoukikan_fax: { type: ['string', 'null'], description: '発行した医療機関のFAX番号' },
          ishi_mei: { type: ['string', 'null'], description: '担当医師の氏名' },
          koufu_bi: { type: ['string', 'null'], description: '交付日。YYYY-MM-DD形式' },
          yuukou_kaishi: { type: ['string', 'null'], description: '有効期間の開始日。YYYY-MM-DD形式' },
          yuukou_shuuryou: { type: ['string', 'null'], description: '有効期間の終了日。YYYY-MM-DD形式' },
          taishousha_hyouki: { type: ['string', 'null'], description: '書類に記載されている対象者(利用者)氏名の表記をそのまま転記' },
          seinengapi: { type: ['string', 'null'], description: '対象者の生年月日。YYYY-MM-DD形式' },
          jusho: { type: ['string', 'null'], description: '対象者の住所' },
          youkaigodo: { type: ['string', 'null'], description: '記載されている要介護度(例: 要介護1、要支援2など)' },
          shubyoumei: {
            type: ['array', 'null'],
            description: '主たる傷病名(診断名)。記載されている病名を1つずつ配列の要素にする。記載がなければnull',
            items: { type: 'string' }
          },
          byoujou_chiryou_joukyou: { type: ['string', 'null'], description: '病状・治療状態・心身の状態の記載内容(投与中の薬剤の用量・用法等を含む)' },
          ryuui_shiji_jikou: { type: ['string', 'null'], description: '留意事項及び指示事項。リハビリテーション、褥瘡の処置等、装着・使用医療機器等の操作援助・管理など、具体的な看護内容の記載' },
          souchaku_iryoukiki: { type: ['string', 'null'], description: '装着・使用中の医療機器等(留置カテーテル、人工呼吸器、経管栄養チューブなど)の記載' },
          juushou_shinshin_shougaiji: { type: ['string', 'null'], description: '重症心身障害児に関する区分。「非該当」「超重症児」「準超重症児」のいずれかが記載・選択されていればそのまま転記' },
          beppyou_taiou: { type: ['string', 'null'], description: '別表7・別表8(特掲診療料の施設基準等)に該当する旨の記載があれば、その内容をそのまま転記。記載がなければnull' },
          hoka_station: { type: ['string', 'null'], description: '他の訪問看護ステーションへの指示がある場合、その名称・所在地など記載内容' },
          kinkyuji_renrakusaki: { type: ['string', 'null'], description: '緊急時の連絡先、不在時の対応法など記載されている連絡先情報' },
          yomitori_biko: { type: ['string', 'null'], description: '読み取りにくかった箇所や、内容に自信が持てない項目についての注記' }
        },
        required: [
          'shiji_shurui', 'jigyousho_mei', 'iryoukikan_mei', 'iryoukikan_shozaichi', 'iryoukikan_denwa', 'iryoukikan_fax',
          'ishi_mei', 'koufu_bi', 'yuukou_kaishi', 'yuukou_shuuryou', 'taishousha_hyouki', 'seinengapi', 'jusho', 'youkaigodo',
          'shubyoumei', 'byoujou_chiryou_joukyou', 'ryuui_shiji_jikou', 'souchaku_iryoukiki', 'juushou_shinshin_shougaiji',
          'beppyou_taiou', 'hoka_station', 'kinkyuji_renrakusaki', 'yomitori_biko'
        ],
        additionalProperties: false
      },
      instructionText: '添付は訪問看護指示書などの医療機関発行の指示書です。記載内容から、スキーマに定義された全項目を読み取ってください。読み取れない、記載がない、または自信が持てない項目はnull(配列項目は空のnull)にし、yomitori_bikoにその旨を記載してください。'
    },

    hokensho: {
      schema: {
        type: 'object',
        properties: {
          hihokensha_bangou: { type: ['string', 'null'], description: '被保険者番号' },
          shimei: { type: ['string', 'null'], description: '被保険者の氏名' },
          seinengapi: { type: ['string', 'null'], description: '生年月日。YYYY-MM-DD形式' },
          jusho: { type: ['string', 'null'], description: '住所' },
          koufu_nengapi: { type: ['string', 'null'], description: '交付年月日。YYYY-MM-DD形式' },
          hokensha_bangou: { type: ['string', 'null'], description: '保険者番号' },
          hokensha_mei: { type: ['string', 'null'], description: '保険者名(市区町村名など)' },
          youkaigo_kubun: { type: ['string', 'null'], description: '要介護状態区分等。必ず次のいずれかの表記に正規化する: 非該当, 自立, 事業対象者, 要支援（経過的要介護）, 要支援1, 要支援2, 要介護1, 要介護2, 要介護3, 要介護4, 要介護5' },
          nintei_nengapi: { type: ['string', 'null'], description: '認定年月日。YYYY-MM-DD形式' },
          nintei_yuukou_kaishi: { type: ['string', 'null'], description: '認定の有効期間 開始日。YYYY-MM-DD形式' },
          nintei_yuukou_shuuryou: { type: ['string', 'null'], description: '認定の有効期間 終了日。YYYY-MM-DD形式' },
          yomitori_biko: { type: ['string', 'null'], description: '読み取りにくかった箇所や、内容に自信が持てない項目についての注記' }
        },
        required: [
          'hihokensha_bangou', 'shimei', 'seinengapi', 'jusho', 'koufu_nengapi', 'hokensha_bangou', 'hokensha_mei',
          'youkaigo_kubun', 'nintei_nengapi', 'nintei_yuukou_kaishi', 'nintei_yuukou_shuuryou', 'yomitori_biko'
        ],
        additionalProperties: false
      },
      instructionText: '添付は介護保険被保険者証です。記載内容から、スキーマに定義された全項目を読み取ってください。読み取れない、記載がない、または自信が持てない項目はnullにし、yomitori_bikoにその旨を記載してください。'
    },

    futanwariai: {
      schema: {
        type: 'object',
        properties: {
          hihokensha_bangou: { type: ['string', 'null'], description: '被保険者番号' },
          shimei: { type: ['string', 'null'], description: '被保険者の氏名' },
          seinengapi: { type: ['string', 'null'], description: '生年月日。YYYY-MM-DD形式' },
          jusho: { type: ['string', 'null'], description: '住所' },
          futan_wariai: { type: ['string', 'null'], description: '利用者負担割合。必ず「1割」「2割」「3割」のいずれかの表記にする' },
          tekiyou_kaishi: { type: ['string', 'null'], description: '適用期間 開始日。YYYY-MM-DD形式' },
          tekiyou_shuuryou: { type: ['string', 'null'], description: '適用期間 終了日。YYYY-MM-DD形式' },
          koufu_nengapi: { type: ['string', 'null'], description: '交付年月日。YYYY-MM-DD形式' },
          hokensha_bangou: { type: ['string', 'null'], description: '保険者番号' },
          hokensha_mei: { type: ['string', 'null'], description: '保険者名(市区町村名など)' },
          yomitori_biko: { type: ['string', 'null'], description: '読み取りにくかった箇所や、内容に自信が持てない項目についての注記' }
        },
        required: [
          'hihokensha_bangou', 'shimei', 'seinengapi', 'jusho', 'futan_wariai', 'tekiyou_kaishi', 'tekiyou_shuuryou',
          'koufu_nengapi', 'hokensha_bangou', 'hokensha_mei', 'yomitori_biko'
        ],
        additionalProperties: false
      },
      instructionText: '添付は介護保険負担割合証です。記載内容から、スキーマに定義された全項目を読み取ってください。読み取れない、記載がない、または自信が持てない項目はnullにし、yomitori_bikoにその旨を記載してください。'
    }
  };

  return CONFIGS[docType] || CONFIGS.shijisho;
}
