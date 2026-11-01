/**
 * 営業AI v5 - Google Apps Script
 * 公開企業情報の週次調査と、本人の承認を前提にした営業準備を行う。
 * 対外メールの自動送信はしない。非公開の関係情報をGeminiへ送らない。
 */
const V5 = Object.freeze({
  publicCsv: 'https://docs.google.com/spreadsheets/d/1OmKyrwSlLxOEPetl5Q17Aox05Ata8FHMxhDEYgtDkX4/export?format=csv&gid=1331008365',
  appUrl: 'https://masato19870410.github.io/ncbc/eigyo5/',
  model: 'gemini-2.5-flash',
  tabs: {
    prospects: '候補企業', signals: 'シグナル', relationships: '関係・イベント', progress: '営業進展', log: '実行ログ'
  },
  headers: {
    prospects: ['会社名','業種','所在地','電話','メール','提案仮説','確認日','公開情報JSON','更新日時'],
    signals: ['検出日時','会社名','シグナル種別','根拠URL','確認済み情報','会う理由','期待効果','予算条件','小さな次の一歩','状態','最終通知日時','指紋'],
    relationships: ['登録日時','会社名','接点種別','相手・イベント名','接点の背景','予定日時','非公開メモ','状態','準備内容','処理日時'],
    progress: ['記録日時','会社名','段階','次回日時','メモ'],
    log: ['日時','処理','結果','詳細']
  }
});

function onOpen() {
  SpreadsheetApp.getUi().createMenu('営業AI v5')
    .addItem('初期設定', 'setupV5')
    .addItem('公開企業を更新', 'refreshPublicProspects')
    .addItem('週次調査を今すぐ実行', 'runWeeklyResearch')
    .addItem('承認済みを処理', 'processApprovedActions')
    .addSeparator().addItem('自動化トリガーを作成', 'installAutomationTriggers')
    .addToUi();
}

function setupV5() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(V5.tabs).forEach(key => ensureSheet_(ss, V5.tabs[key], V5.headers[key]));
  refreshPublicProspects();
  log_('初期設定', '完了', '必要なシートを作成しました');
  SpreadsheetApp.getUi().alert('初期設定が完了しました。READMEに従って通知先とGemini APIキーを設定してください。');
}

function ensureSheet_(ss, name, headers) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#dff1e9');
  return sh;
}

function refreshPublicProspects() {
  const ss = SpreadsheetApp.getActive();
  const sh = ensureSheet_(ss, V5.tabs.prospects, V5.headers.prospects);
  const response = UrlFetchApp.fetch(V5.publicCsv, {muteHttpExceptions:true});
  if (response.getResponseCode() !== 200) throw new Error('公開CSV取得失敗: HTTP ' + response.getResponseCode());
  const rows = Utilities.parseCsv(response.getContentText('UTF-8'));
  const h = rows.shift(); const ix = {}; h.forEach((v,i)=>ix[v.trim()]=i);
  const values = rows.filter(r=>r[ix.name]).map(r => [
    r[ix.name], r[ix.industry], r[ix.area], r[ix.phone], r[ix.email], r[ix.proposal], r[ix.verified_at],
    JSON.stringify({summary:r[ix.summary],sales:r[ix.hypothesis_sales],hr:r[ix.hypothesis_hr],pr:r[ix.hypothesis_pr],note:r[ix.approach_note],channels:safeJson_(r[ix.channels_json],[]),capitalMan:r[ix.capital_man],revenueMan:r[ix.revenue_man]}),
    new Date()
  ]);
  if (sh.getLastRow() > 1) sh.getRange(2,1,sh.getLastRow()-1,V5.headers.prospects.length).clearContent();
  if (values.length) sh.getRange(2,1,values.length,values[0].length).setValues(values);
  log_('公開企業更新', '完了', values.length + '社');
  return values.length;
}

function installAutomationTriggers() {
  const handlers=['runWeeklyResearch','handleSheetEdit'];
  ScriptApp.getProjectTriggers().filter(t=>handlers.includes(t.getHandlerFunction())).forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runWeeklyResearch').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  ScriptApp.newTrigger('handleSheetEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  log_('トリガー設定', '完了', '毎週月曜8時台 / シート編集時');
  SpreadsheetApp.getUi().alert('週次調査とシート編集時のトリガーを設定しました。通知は条件を満たす場合だけ、週1件までです。');
}

function runWeeklyResearch() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const ss = SpreadsheetApp.getActive();
    const psh = ensureSheet_(ss, V5.tabs.prospects, V5.headers.prospects);
    const ssh = ensureSheet_(ss, V5.tabs.signals, V5.headers.signals);
    if (psh.getLastRow() < 2) refreshPublicProspects();
    const rows = psh.getDataRange().getValues().slice(1).filter(r=>r[0]);
    const existing = existingFingerprints_(ssh);
    const candidates = [];
    rows.forEach(row => {
      const publicData = {name:row[0],industry:row[1],area:row[2],proposal:row[5],verifiedAt:row[6],facts:safeJson_(row[7],{})};
      const result = analyzePublicProspect_(publicData);
      result.company = publicData.name;
      result.fingerprint = digest_([result.company,result.signalType,result.evidenceUrl,result.confirmedFact].join('|'));
      if (result.ready && !existing[result.fingerprint]) candidates.push(result);
    });
    candidates.sort((a,b)=>b.confidence-a.confidence);
    candidates.forEach(c=>appendSignal_(ssh,c));
    const best = candidates.find(c=>c.confidence>=70);
    if (best && canNotifyThisWeek_(ssh)) notifySelf_(best, ssh);
    log_('週次調査', '完了', `新規${candidates.length}件 / 通知${best&&best.confidence>=70?'候補あり':'なし'}`);
  } catch (e) {
    log_('週次調査', 'エラー', e.stack || e.message); throw e;
  } finally { lock.releaseLock(); }
}

function analyzePublicProspect_(p) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) return ruleBasedAnalysis_(p, 'Gemini未設定');
  const prompt = [
    '岡山の地域企業と、売り込みではなく自然な情報交換・取材・紹介・イベント接点を作る営業準備です。',
    '入力は公開情報のみです。事実と仮説を分け、金額を捏造しないでください。',
    '会社: '+p.name, '業種: '+p.industry, '所在地: '+p.area, '既存提案仮説: '+p.proposal,
    '公開情報JSON: '+JSON.stringify(p.facts),
    '最近の公開活動、イベント、業界団体、求人・広報上の変化を検索し、会う合理的な理由がある場合だけready=trueにしてください。',
    'JSONのみ: {"ready":boolean,"confidence":0-100,"signalType":"イベント|公開活動|求人|業界団体|その他","evidenceUrl":"https://... または空","confirmedFact":"確認済み事実","naturalReason":"会う理由","expectedValue":"相手の期待効果。未算定なら必要情報","budgetReason":"予算が生まれる条件","nextStep":"15分以内で始められる一歩"}'
  ].join('\n');
  try {
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${V5.model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',muteHttpExceptions:true,payload:JSON.stringify({contents:[{parts:[{text:prompt}]}],tools:[{google_search:{}}],generationConfig:{responseMimeType:'application/json',temperature:.2}})});
    if(res.getResponseCode()!==200) return ruleBasedAnalysis_(p,'Gemini HTTP '+res.getResponseCode());
    const data=JSON.parse(res.getContentText());
    const text=data.candidates&&data.candidates[0]&&data.candidates[0].content.parts.map(x=>x.text||'').join('');
    const parsed=safeJson_(text,null);
    if(!parsed) return ruleBasedAnalysis_(p,'Gemini JSON解析失敗');
    return normalizeAnalysis_(parsed,p);
  } catch(e) { return ruleBasedAnalysis_(p,'Gemini失敗: '+e.message); }
}

function normalizeAnalysis_(x,p) {
  return {ready:!!x.ready,confidence:Math.max(0,Math.min(100,Number(x.confidence)||0)),signalType:String(x.signalType||'その他').slice(0,30),evidenceUrl:/^https:\/\//.test(x.evidenceUrl||'')?x.evidenceUrl:'',confirmedFact:String(x.confirmedFact||'').slice(0,700),naturalReason:String(x.naturalReason||'').slice(0,500),expectedValue:String(x.expectedValue||'効果は未算定').slice(0,500),budgetReason:String(x.budgetReason||'予算は未確認').slice(0,500),nextStep:String(x.nextStep||'公開情報を追加確認').slice(0,300)};
}

function ruleBasedAnalysis_(p, reason) {
  const f=p.facts||{}, channels=Array.isArray(f.channels)?f.channels:[];
  const group=channels.find(c=>/業界団体|商工|組合/.test(c.n||'')&&c.u);
  const news=channels.find(c=>/ニュース|お知らせ/.test(c.n||'')&&c.u);
  const social=channels.find(c=>/Instagram|Facebook|X|note/.test(c.n||'')&&c.u&&(c.r==='◎'||c.r==='○'));
  const hit=group||news||social; const type=group?'業界団体':news?'公開活動':social?'公開活動':'その他';
  return {ready:!!hit,confidence:hit?(group?78:72):35,signalType:type,evidenceUrl:hit&&hit.u||'',confirmedFact:hit&&hit.m||reason,naturalReason:group?'業界団体での活動を起点に、業界課題を聞く情報交換を提案する。':hit?'公開活動を読んだうえで、取り組みの背景を聞く短い取材を提案する。':'自然な接点が不足しているため連絡せず、紹介者やイベントを探す。',expectedValue:p.proposal?`${p.proposal} 効果額は現状値を聞いてから算定する。`:'効果は未算定。',budgetReason:(f.revenueMan||f.capitalMan)?'公開された会社規模は参考にし、小さな有料検証の予算可否を確認する。':'予算は未確認。無料提案を続けず有料化条件を確認する。',nextStep:hit?'公開情報を5分確認し、15分の情報交換を依頼する。':'地域の知人・支援機関に接点がないか1人だけ聞く。'};
}

function appendSignal_(sh,c) {
  sh.appendRow([new Date(),c.company,c.signalType,c.evidenceUrl,c.confirmedFact,c.naturalReason,c.expectedValue,c.budgetReason,c.nextStep,'候補','',c.fingerprint]);
}

function existingFingerprints_(sh) {
  const out={}; if(sh.getLastRow()<2)return out;
  sh.getRange(2,12,sh.getLastRow()-1,1).getValues().flat().forEach(v=>{if(v)out[v]=true}); return out;
}

function canNotifyThisWeek_(sh) {
  if(sh.getLastRow()<2)return true; const week=7*24*60*60*1000, now=Date.now();
  return !sh.getRange(2,11,sh.getLastRow()-1,1).getValues().flat().some(v=>v instanceof Date&&now-v.getTime()<week);
}

function notifySelf_(c,sh) {
  const props=PropertiesService.getScriptProperties();
  const email=props.getProperty('NOTIFY_EMAIL')||Session.getEffectiveUser().getEmail();
  if(!email)throw new Error('NOTIFY_EMAILが未設定です');
  const subject=`【営業AI v5】今週、会う理由がある1社：${c.company}`;
  const body=[`${c.company}について、連絡件数を増やすのではなく「会う意味」が揃った候補を1件だけお知らせします。`,'',`確認済み: ${c.confirmedFact}`,`会う理由: ${c.naturalReason}`,`期待効果: ${c.expectedValue}`,`予算条件: ${c.budgetReason}`,`小さな一歩: ${c.nextStep}`,'',`根拠: ${c.evidenceUrl||'シートを確認'}`,`公開v5: ${V5.appUrl}`,'','この通知を無視した場合、同じ内容は再送しません。営業先への送信も自動では行いません。'].join('\n');
  MailApp.sendEmail({to:email,subject,body,name:'営業AI v5'});
  const values=sh.getDataRange().getValues(); for(let r=values.length-1;r>=1;r--)if(values[r][11]===c.fingerprint){sh.getRange(r+1,11).setValue(new Date());break}
}

function handleSheetEdit(e) {
  if (!e || !e.range) return;
  const name=e.range.getSheet().getName();
  if(name===V5.tabs.relationships && e.range.getRow()>1) prepareRelationshipRow_(e.range.getSheet(),e.range.getRow());
  if((name===V5.tabs.relationships||name===V5.tabs.signals) && /承認/.test(String(e.value||''))) processApprovedActions();
}

function prepareRelationshipRow_(sh,row) {
  const v=sh.getRange(row,1,1,V5.headers.relationships.length).getValues()[0];
  if(!v[0])sh.getRange(row,1).setValue(new Date());
  if(!v[1]||!v[2])return;
  // 非公開メモは外部AIへ送らず、入力内容からローカルルールだけで準備する。
  const type=String(v[2]), person=String(v[3]||'相手');
  const prep=type.includes('イベント')?`${person}に参加する目的を「売り込み」ではなく、業界課題を1つ聞くことに置く。終了後に15分の情報交換を相談する。`:type.includes('紹介')?`紹介者へ、${v[1]}に売り込みたいのではなく課題を聞きたい旨を伝え、15分だけ話せるか確認する。`:`${person}との過去の接点を1つ確認し、近況確認から始める。`;
  sh.getRange(row,9,1,2).setValues([[prep,new Date()]]);
  if(!v[7])sh.getRange(row,8).setValue('準備済み');
}

function processApprovedActions() {
  const ss=SpreadsheetApp.getActive();
  processRelationshipApprovals_(ensureSheet_(ss,V5.tabs.relationships,V5.headers.relationships));
  processSignalApprovals_(ensureSheet_(ss,V5.tabs.signals,V5.headers.signals),ensureSheet_(ss,V5.tabs.prospects,V5.headers.prospects));
}

function processRelationshipApprovals_(sh) {
  if(sh.getLastRow()<2)return; const data=sh.getRange(2,1,sh.getLastRow()-1,V5.headers.relationships.length).getValues();
  data.forEach((r,i)=>{if(r[7]!=='予定承認'||!(r[5] instanceof Date))return;const start=r[5],end=new Date(start.getTime()+30*60000);CalendarApp.getDefaultCalendar().createEvent(`${r[1]}との情報交換`,start,end,{description:`接点: ${r[2]} / ${r[3]}\n準備: ${r[8]}\n本人承認済み。`});sh.getRange(i+2,8).setValue('予定作成済み');sh.getRange(i+2,10).setValue(new Date())});
}

function processSignalApprovals_(signalSh,prospectSh) {
  if(signalSh.getLastRow()<2)return;const signals=signalSh.getRange(2,1,signalSh.getLastRow()-1,V5.headers.signals.length).getValues();const prospects=prospectSh.getDataRange().getValues();const byName={};prospects.slice(1).forEach(r=>byName[r[0]]=r);
  signals.forEach((r,i)=>{if(r[9]!=='下書き承認')return;const p=byName[r[1]],to=p&&p[4];if(!to){signalSh.getRange(i+2,10).setValue('メール未確認');return}const subject='情報交換のお願い';const body=`${r[1]}様\n\n${r[4]}を拝見し、ご連絡しました。\nいきなりサービスをご提案するのではなく、${r[5]}\n\nまず15分ほど現状を伺い、効果が見込める場合だけ小さな検証案をお持ちします。`;GmailApp.createDraft(to,subject,body);signalSh.getRange(i+2,10).setValue('下書き作成済み')});
}

function safeJson_(s,fallback){try{return JSON.parse(s)}catch(e){return fallback}}
function digest_(s){return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s)).slice(0,24)}
function log_(task,result,detail){const ss=SpreadsheetApp.getActive();const sh=ensureSheet_(ss,V5.tabs.log,V5.headers.log);sh.appendRow([new Date(),task,result,String(detail||'').slice(0,2000)])}
