import { readFile, writeFile } from 'node:fs/promises';

const KIDS = new URL('../data/seoul-heritage-sites-kids.json', import.meta.url);
const BASE = new URL('../data/seoul-heritage-sites-expanded.json', import.meta.url);
const kidFields = ['summaryKid', 'descriptionKid', 'whyImportantKid'];
const stats = { awkward: new Set(), simplify: new Set(), repetition: new Set(), split: new Set(), changed: new Set() };

const replacements = [
  [/자료이에요/g, '자료예요', 'awkward'], [/자리이에요/g, '자리예요', 'awkward'], [/것이에요/g, '거예요', 'awkward'],
  [/되어 있어요/g, '돼 있어요', 'awkward'], [/되어 있었/g, '돼 있었', 'awkward'], [/되어/g, '돼', 'awkward'],
  [/하였다\./g, '했어요.', 'awkward'], [/하였다/g, '했어요', 'awkward'], [/되었다\./g, '됐어요.', 'awkward'],
  [/사용되었다\./g, '쓰였어요.', 'simplify'], [/사용되었/g, '쓰였', 'simplify'], [/사용하였다/g, '썼어요', 'simplify'],
  [/건립되었/g, '세워졌', 'simplify'], [/건립한/g, '세운', 'simplify'], [/건립하여/g, '세워', 'simplify'],
  [/조성되었/g, '만들어졌', 'simplify'], [/조성한/g, '만든', 'simplify'], [/조성하여/g, '만들어', 'simplify'],
  [/축조하였/g, '쌓아 만들었', 'simplify'], [/현존하는/g, '지금까지 남아 있는', 'simplify'],
  [/목조건물/g, '나무로 만든 건물', 'simplify'], [/목조 건물/g, '나무로 만든 건물', 'simplify'],
  [/석조 건물/g, '돌로 만든 건물', 'simplify'], [/석조건물/g, '돌로 만든 건물', 'simplify'],
  [/건축양식/g, '건축 모습과 만드는 방식', 'simplify'], [/건축 양식/g, '건축 모습과 만드는 방식', 'simplify'],
  [/양식을/g, '모양과 만드는 방식을', 'simplify'], [/양식의/g, '모양과 만드는 방식의', 'simplify'],
  [/귀중한 자료가 된다\./g, '귀중한 자료가 돼요.', 'awkward'], [/중요한 자료가 된다\./g, '중요한 자료가 돼요.', 'awkward'],
  [/의의가 있다\./g, '중요한 의미가 있어요.', 'simplify'], [/가치가 크다\./g, '가치가 커요.', 'awkward'],
  [/알 수 있다\./g, '알 수 있어요.', 'awkward'], [/보여준다\./g, '보여 줘요.', 'awkward'],
  [/하고 있다\./g, '하고 있어요.', 'awkward'], [/남아 있다\./g, '남아 있어요.', 'awkward'],
  [/이에요라는 점에서 당시의 모습을 이해하는 데 중요해요\./g, '이에요. 이 사실은 당시의 모습을 이해하는 데 도움을 줘요.', 'awkward'],
  [/해요라는 점에서 당시의 모습을 이해하는 데 중요해요\./g, '해요. 이 사실은 당시의 모습을 이해하는 데 도움을 줘요.', 'awkward'],
  [/있어요라는 점에서 당시의 모습을 이해하는 데 중요해요\./g, '있어요. 이 사실은 당시의 모습을 이해하는 데 도움을 줘요.', 'awkward'],
  [/([^입])이다\./g, '$1이에요.', 'awkward'], [/우리 나라/g, '우리나라', 'awkward'], [/년동안/g, '년 동안', 'awkward'],
  [/<br\s*\/?\s*>/gi, ' ', 'awkward'], [/<\/?b>/gi, '', 'awkward'], [/※.*$/g, '', 'awkward'],
];

function clean(value, id) {
  let output = value;
  for (const [pattern, replacement, type] of replacements) {
    const next = output.replace(pattern, replacement);
    if (next !== output) stats[type].add(id);
    output = next;
  }
  output = output.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  return output;
}

function splitLong(value, id) {
  const parts = value.split(/(?<=[.!?])\s+/);
  const result = parts.map(sentence => {
    if ([...sentence].length <= 180) return sentence;
    const rules = [
      [/, 또한 /, '. 또한 '], [/, 그리고 /, '. 그리고 '], [/이며, /, '이에요. 또한 '],
      [/하였으며, /, '했어요. 그리고 '], [/했으며, /, '했어요. 그리고 '],
      [/있으며, /, '있어요. 또한 '], [/되며, /, '돼요. 또한 '], [/이고, /, '이에요. 그리고 '],
    ];
    for (const [pattern, replacement] of rules) {
      const next = sentence.replace(pattern, replacement);
      if (next !== sentence) { stats.split.add(id); return next; }
    }
    return sentence;
  });
  return result.join(' ');
}

const words = value => new Set(value.replace(/[^가-힣A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(x => x.length > 1));
function similarity(a, b) {
  const aa = words(a), bb = words(b);
  if (!aa.size || !bb.size) return 0;
  const same = [...aa].filter(x => bb.has(x)).length;
  return same / Math.min(aa.size, bb.size);
}

function reduceRepetition(item) {
  const descriptionParts = item.descriptionKid.split(/(?<=[.!?])\s+/).slice(1);
  if (!descriptionParts.some(part => similarity(part, item.whyImportantKid) >= 0.82)) return item.whyImportantKid;
  const originalParts = item.descriptionOriginal.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
  const valuePattern = /가치|중요|의의|귀중|자료|유일|하나뿐|대표|연구/;
  const alternative = [...originalParts].reverse().find(part => valuePattern.test(part) && similarity(part, item.whyImportantKid) < 0.82 && part.length <= 240);
  stats.repetition.add(item.id);
  if (alternative) return clean(alternative, item.id);
  return `${item.whyImportantKid} 이 내용은 당시의 모습을 이해하는 데 도움을 줘요.`;
}

const base = JSON.parse(await readFile(BASE, 'utf8'));
const data = JSON.parse(await readFile(KIDS, 'utf8'));
if (data.length !== 123 || base.length !== data.length) throw new Error('항목 수가 123건이 아닙니다.');
for (const item of data) {
  const before = Object.fromEntries(kidFields.map(field => [field, item[field]]));
  for (const field of kidFields) item[field] = splitLong(clean(item[field], item.id), item.id);
  item.whyImportantKid = reduceRepetition(item);
  if (item.id === '13-0000110000000-11' && [...item.whyImportantKid].length > 180) {
    item.whyImportantKid = '토관, 큰길, 집터, 기와 건물터 같은 백제 초기의 흔적이 확인되었어요. 이 자료들은 풍납토성이 백제 역사를 밝히는 데 중요한 유적임을 보여 줘요.';
    stats.split.add(item.id);
  }
  if (kidFields.some(field => item[field] !== before[field])) stats.changed.add(item.id);
}
for (let i = 0; i < data.length; i++) for (const field of Object.keys(base[i])) {
  if (JSON.stringify(base[i][field]) !== JSON.stringify(data[i][field])) throw new Error(`${base[i].id}: 원본 필드 변경 ${field}`);
}
if (data.some(item => kidFields.some(field => !item[field]))) throw new Error('빈 학생용 필드가 있습니다.');
await writeFile(KIDS, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, value.size])), null, 2));
