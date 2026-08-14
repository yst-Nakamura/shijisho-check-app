/**
 * KANTAKI-WIZ 自動入力ブックマークレット(お試し版)
 * 対応: 指示書 / 介護保険証 / 介護負担割合証
 *
 * 使い方:
 * 1. このファイルの中身をブラウザのブックマークバーに新規ブックマークとして登録する
 *    (名前は何でもよい。URL欄には、このファイルと同じフォルダにある
 *     bookmarklet-minified.txt の中身をそのまま貼り付ける)
 * 2. 指示書AI読取アプリで、書類の種類を選び「KANTAKI-WIZ用にコピー」を押す
 * 3. KANTAKI-WIZの該当画面(利用者IDは先に選択しておく)でブックマークを押す
 *    - 指示書: 指示書の入力画面
 *    - 介護保険証: 「介護保険証」の新規追加(または編集)ポップアップを開いた状態
 *    - 介護負担割合証: 負担割合の履歴に「＋新規追加」で行を追加した状態
 * 4. 表示されるダイアログに、コピーした内容を貼り付けてOK
 * 5. 自動入力後、内容を必ず確認してから保存すること(このブックマークレットは保存ボタンは押さない)
 *
 * 注意:
 * - 利用者氏名・生年月日・要介護度(現況)・住所は、KANTAKI-WIZ側で「利用者ID」を検索して
 *   選択したときに自動表示される項目(表示専用)のため、このブックマークレットでは自動入力しない
 * - 指示書: 看護区分・指示区分は指示書の種類から推測して自動選択する(念のため必ず確認すること)。
 *   報告書年月日は指示期間開始日が属する月の月末日を自動計算する
 * - 介護保険証: 認定日・認定有効期間の入力後、「認定有効期間を区分支給限度額管理期間に反映する」
 *   ボタンを自動で押し、区分支給限度額管理期間にも同じ期間を反映する
 * - 介護負担割合証: 先に「＋新規追加」で履歴行を追加してから実行すること。行の項目名にある
 *   連番(既存レコードのIDではなく数字のキー)を自動で探して入力する
 */
(function () {
  var raw = prompt('指示書AI読取アプリでコピーしたJSONを貼り付けてください');
  if (!raw) return;

  var d;
  try {
    d = JSON.parse(raw);
  } catch (e) {
    alert('JSONの形式が正しくありません。コピーした内容をそのまま貼り付けてください。');
    return;
  }

  function fireEvents(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setByName(name, value) {
    if (value === undefined || value === null || value === '') return;
    var el = document.querySelector('[name="upAry[' + name + ']"]');
    if (!el) return;
    el.value = value;
    fireEvents(el);
  }

  function setByClass(cls, value) {
    if (value === undefined || value === null || value === '') return null;
    var el = document.querySelector('.' + cls);
    if (!el) return null;
    el.value = value;
    fireEvents(el);
    return el;
  }

  function fillShijisho(d) {
    setByName('direction_start', d.direction_start);
    setByName('direction_end', d.direction_end);
    setByName('report_day', d.report_day);
    setByName('rece_detail', d.rece_detail);
    setByName('postscript', d.postscript);
    setByName('other_station1', d.other_station1);
    setByName('hospital', d.hospital);
    setByName('address1', d.address1);
    setByName('tel1', d.tel1);
    setByName('fax', d.fax);
    setByName('doctor', d.doctor);
    setByName('care_kb', d.care_kb);
    setByName('direction_kb', d.direction_kb);

    if (d.sickness && d.sickness.length) {
      for (var i = 0; i < d.sickness.length && i < 10; i++) {
        setByName('sickness' + (i + 1), d.sickness[i]);
      }
    }

    if (d.attached8) {
      var cb = document.querySelector('[name="upAry[attached8]"]');
      if (cb && !cb.checked) {
        cb.checked = true;
        fireEvents(cb);
      }
    }

    alert('自動入力しました(指示書)。内容を必ず確認してください。\n(利用者氏名・生年月日・要介護度・住所は別途「利用者ID」検索で選択してください)');
  }

  function fillHokensho(d) {
    // 認定日
    setByClass('ins1_certif_nengo', d.certif_nengo);
    setByClass('ins1_certif_year1_1', d.certif_year);
    setByClass('ins1_certif_month1', d.certif_month);
    setByClass('ins1_certif_dt1', d.certif_dt);
    // 認定有効期間
    setByClass('ins1_start_nengo', d.start_nengo);
    setByClass('ins1_start_year1_1', d.start_year);
    setByClass('ins1_start_month1', d.start_month);
    setByClass('ins1_start_dt1', d.start_dt);
    setByClass('ins1_end_nengo', d.end_nengo);
    setByClass('ins1_end_year1', d.end_year);
    setByClass('ins1_end_month1', d.end_month);
    setByClass('ins1_end_dt1', d.end_dt);
    // 保険者番号・被保険者番号・要介護度
    setByClass('ins1_insure_no', d.insure_no);
    setByClass('ins1_insured_no', d.insured_no);
    setByClass('ins1_care_rank', d.care_rank);

    // 認定有効期間を区分支給限度額管理期間にコピー(サイト自体のボタン機能を利用)
    var copyBtn = document.getElementById('btnCopyIns1');
    if (copyBtn) copyBtn.click();

    alert('自動入力しました(介護保険証)。区分支給限度額管理期間にも同じ期間を反映しました。内容を必ず確認してから登録してください。');
  }

  function fillFutanwariai(d) {
    // 既存レコード(isr...等のID)ではなく、数字だけのキーを持つ「新規追加行」を探す
    var startSelects = Array.from(document.querySelectorAll('select[name^="upDummy[ins2]["]'));
    var target = startSelects.find(function (el) {
      return /^upDummy\[ins2\]\[\d+\]\[start_nengo\]$/.test(el.name);
    });
    if (!target) {
      alert('負担割合の「新規追加」行が見つかりませんでした。先に「＋新規追加」ボタンで行を追加してから、もう一度実行してください。');
      return;
    }
    var m = /^upDummy\[ins2\]\[(\d+)\]/.exec(target.name);
    var key = m[1];

    // upDummy[ins2][key][...] はsetByNameの'upAry['プレフィックス前提と形が違うため個別に処理
    function setIns2(field, value) {
      if (value === undefined || value === null || value === '') return;
      var el = document.querySelector('[name="upDummy[ins2][' + key + '][' + field + ']"]');
      if (el) { el.value = value; fireEvents(el); }
    }
    setIns2('start_nengo', d.start_nengo);
    setIns2('start_year', d.start_year);
    setIns2('start_month', d.start_month);
    setIns2('start_dt', d.start_dt);
    setIns2('end_nengo', d.end_nengo);
    setIns2('end_year', d.end_year);
    setIns2('end_month', d.end_month);
    setIns2('end_dt', d.end_dt);

    var rateEl = document.querySelector('[name="upIns2[' + key + '][rate]"]');
    if (rateEl && d.rate) { rateEl.value = d.rate; fireEvents(rateEl); }

    alert('自動入力しました(介護負担割合証)。内容を必ず確認してから保存してください。');
  }

  if (d.docType === 'hokensho') {
    fillHokensho(d);
  } else if (d.docType === 'futanwariai') {
    fillFutanwariai(d);
  } else {
    fillShijisho(d);
  }
})();
