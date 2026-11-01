const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(__dirname + '/gas-code.js', 'utf8');
const context = vm.createContext({console});
vm.runInContext(source, context);

const run = expression => vm.runInContext(expression, context);

const groupResult = run(`ruleBasedAnalysis_({
  name:'テスト建具', industry:'建具店', proposal:'採用ページ改善',
  facts:{channels:[{n:'業界団体',r:'○',u:'https://example.com/group',m:'正会員名簿に掲載'}],capitalMan:'500'}
}, 'fallback')`);
assert.equal(groupResult.ready, true);
assert.equal(groupResult.signalType, '業界団体');
assert.ok(groupResult.confidence >= 70);
assert.match(groupResult.naturalReason, /業界団体/);

const noSignal = run(`ruleBasedAnalysis_({
  name:'接点なし企業', industry:'製造業', proposal:'', facts:{channels:[]}
}, 'Gemini未設定')`);
assert.equal(noSignal.ready, false);
assert.equal(noSignal.confidence, 35);
assert.match(noSignal.nextStep, /知人|支援機関/);

const normalized = run(`normalizeAnalysis_({
  ready:true, confidence:120, signalType:'イベント', evidenceUrl:'javascript:alert(1)',
  confirmedFact:'公開イベント', naturalReason:'取材', expectedValue:'未算定', budgetReason:'要確認', nextStep:'参加'
}, {})`);
assert.equal(normalized.confidence, 100);
assert.equal(normalized.evidenceUrl, '');

console.log('gas-logic: 3 scenarios passed');
