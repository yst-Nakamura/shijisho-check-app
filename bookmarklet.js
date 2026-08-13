/**
 * KANTAKI-WIZ 指示書画面 自動入力ブックマークレット(お試し版)
 *
 * 使い方:
 * 1. このファイルの中身をブラウザのブックマークバーに新規ブックマークとして登録する
 *    (名前は何でもよい。URL欄には、このファイルと同じフォルダにある
 *     bookmarklet-minified.txt の中身をそのまま貼り付ける)
 * 2. 指示書AI読取アプリで「KANTAKI-WIZ用にコピー」を押す
 * 3. KANTAKI-WIZの指示書入力画面(利用者IDは先に選択しておく)でブックマークを押す
 * 4. 表示されるダイアログに、コピーした内容を貼り付けてOK
 *
 * 注意:
 * - 利用者氏名・生年月日・要介護度・住所は、KANTAKI-WIZ側で「利用者ID」を検索して
 *   選択したときに自動表示される項目(表示専用)のため、このブックマークレットでは
 *   自動入力しない。利用者IDの選択は必ず手動で行うこと
 * - 看護区分・指示区分は、指示書の種類から推測して自動選択する(念のため必ず確認すること)
 * - 指示期間(ヵ月)のプルダウン、重症心身障害児のラジオボタンは
 *   選択肢の値を未確認のため、今回は対象外(必要になったら追加する)
 * - 報告書年月日はKANTAKI-WIZ側で自動計算される仕様のため、このブックマークレットでは触らない
 * - 自動入力後も、内容が正しいか必ず目で確認すること
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

  function setVal(name, value) {
    if (value === undefined || value === null || value === '') return;
    var el = document.querySelector('[name="upAry[' + name + ']"]');
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  setVal('direction_start', d.direction_start);
  setVal('direction_end', d.direction_end);
  setVal('rece_detail', d.rece_detail);
  setVal('postscript', d.postscript);
  setVal('other_station1', d.other_station1);
  setVal('hospital', d.hospital);
  setVal('address1', d.address1);
  setVal('tel1', d.tel1);
  setVal('fax', d.fax);
  setVal('doctor', d.doctor);
  setVal('care_kb', d.care_kb);
  setVal('direction_kb', d.direction_kb);

  if (d.sickness && d.sickness.length) {
    for (var i = 0; i < d.sickness.length && i < 10; i++) {
      setVal('sickness' + (i + 1), d.sickness[i]);
    }
  }

  if (d.attached8) {
    var cb = document.querySelector('[name="upAry[attached8]"]');
    if (cb && !cb.checked) {
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  alert('自動入力しました。内容を必ず確認してください。\n(利用者氏名・生年月日・要介護度・住所は別途「利用者ID」検索で選択してください)');
})();
