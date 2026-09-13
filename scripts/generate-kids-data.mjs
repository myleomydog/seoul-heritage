import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const SOURCE = new URL('../data/seoul-heritage-sites-expanded.json', import.meta.url);
const OUTPUT = new URL('../data/seoul-heritage-sites-kids.json', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const tidy = value => String(value || '').replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
const sentences = value => tidy(value).split(/(?<=[.!?])\s+|\n+/).map(tidy).filter(x => x.length > 8);
const end = value => /[.!?]$/.test(value) ? value : `${value}.`;

function topic(name) {
  const code = [...name].pop()?.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 ? '은' : '는';
}

function easy(value) {
  return tidy(value)
    .replace(/\([一-龥·\s]+\)/g, '')
    .replace(/∼/g, '~').replace(/현존하는/g, '지금까지 남아 있는')
    .replace(/건립하였다/g, '세웠어요').replace(/건립되었다/g, '세워졌어요')
    .replace(/축조하였다/g, '쌓아 만들었어요').replace(/조성하였다/g, '만들었어요')
    .replace(/조성되었다/g, '만들어졌어요').replace(/복원하였다/g, '원래 모습에 가깝게 다시 만들었어요')
    .replace(/유일한/g, '하나뿐인').replace(/사찰/g, '절').replace(/석탑/g, '돌탑')
    .replace(/목조건축물/g, '나무 건축물').replace(/왕릉/g, '왕과 왕비의 무덤')
    .replace(/양식/g, '모양과 만드는 방식').replace(/사료/g, '역사를 알아보는 자료')
    .replace(/가치를 지닌다\.?$/, '가치가 있어요.').replace(/가치가 있다\.?$/, '가치가 있어요.')
    .replace(/중요하다\.?$/, '중요해요.').replace(/알 수 있다\.?$/, '알 수 있어요.')
    .replace(/볼 수 있다\.?$/, '볼 수 있어요.').replace(/보여준다\.?$/, '보여 줘요.')
    .replace(/하고 있다\.?$/, '하고 있어요.').replace(/되어 있다\.?$/, '되어 있어요.')
    .replace(/남아 있다\.?$/, '남아 있어요.').replace(/이다\.?$/, '이에요.').replace(/한다\.?$/, '해요.');
}

function summaryKid(item) {
  if (item.designation === '사적') return '옛사람들이 남긴 장소와 흔적으로 당시 역사와 생활 모습을 알려 주는 유산이에요.';
  if (item.designation === '명승') return '아름다운 자연과 역사 문화의 모습을 한곳에서 살펴볼 수 있는 소중한 장소예요.';
  if (item.designation === '천연기념물') return '오랜 시간 자라 온 나무를 통해 자연과 사람들의 생활을 함께 살펴볼 수 있어요.';
  if (item.category === '유적건조물') return '옛 건축물의 모습과 만드는 기술을 통해 당시 생활과 문화를 알려 주는 유산이에요.';
  return `${item.period ? `${item.period}의 ` : ''}역사와 문화를 구체적으로 보여 주는 ${item.designation}이에요.`;
}

function descriptionKid(item) {
  const intro = `${item.name}${topic(item.name)} 서울 ${item.district}에 있는 ${item.designation}이에요.`;
  const picked = [];
  const sourceParts = tidy(item.descriptionOriginal).split(/(?<=[.!?])\s+|\n+|;\s*/).map(tidy).filter(Boolean);
  for (const sentence of sourceParts) {
    const candidate = easy(sentence);
    if (candidate.length >= 15 && candidate.length <= 190 && !picked.includes(candidate)) picked.push(end(candidate));
    if (picked.length === 2) break;
  }
  return [intro, ...picked].join(' ');
}

function whyImportantKid(item) {
  const source = tidy(item.descriptionOriginal).split(/(?<=[.!?])\s+|\n+|;\s*/).map(tidy).filter(x => x.length > 8);
  const marker = /가치|중요|자료|대표|특징|잘 남|알 수|보여|의의|하나뿐|유일|귀중|뛰어|지정.?보호/;
  const score = (value, index) =>
    (/가치/.test(value) ? 12 : 0) + (/중요|의의/.test(value) ? 10 : 0) +
    (/지정.?보호|귀중|유일|하나뿐/.test(value) ? 8 : 0) +
    (/대표|자료|잘 남|뛰어/.test(value) ? 6 : 0) + (/특징|보여|알 수/.test(value) ? 3 : 0) + index / 1000;
  const candidates = source.map((value, index) => ({ value, index, score: score(value, index) }))
    .filter(x => marker.test(x.value) && x.value.length <= 300).sort((a, b) => b.score - a.score);
  let result = easy(candidates[0]?.value || source.find(x => x.length <= 240) || source.at(-1) || '');
  if (result.length > 300) {
    const clauses = result.split(/[,;]/).filter(Boolean);
    result = clauses.find(x => marker.test(x) && x.length < 220) || clauses[0];
  }
  return result ? end(result) : '';
}

async function main() {
  const sourceBytes = await readFile(SOURCE);
  const sourceHash = hash(sourceBytes);
  const source = JSON.parse(sourceBytes.toString('utf8'));
  if (source.length !== 123) throw new Error(`예상 123건, 실제 ${source.length}건`);
  const result = source.map(item => ({
    ...item,
    summaryKid: summaryKid(item),
    descriptionKid: descriptionKid(item),
    whyImportantKid: whyImportantKid(item),
  }));
  for (let i = 0; i < source.length; i += 1) {
    for (const field of Object.keys(source[i])) {
      if (JSON.stringify(source[i][field]) !== JSON.stringify(result[i][field])) throw new Error(`${source[i].id}: 기존 필드 변경 ${field}`);
    }
  }
  const difficult = result.filter(x => !x.summaryKid || !x.descriptionKid || !x.whyImportantKid);
  if (difficult.length) throw new Error(`빈 설명 필드 ${difficult.length}건`);
  await writeFile(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (sourceHash !== hash(await readFile(SOURCE))) throw new Error('원본 파일이 변경되었습니다.');
  const summaryLengths = result.map(x => [...x.summaryKid].length);
  const descriptionCounts = result.map(x => sentences(x.descriptionKid).length);
  console.log(JSON.stringify({
    processed: result.length,
    summarySuccess: result.filter(x => x.summaryKid).length,
    descriptionSuccess: result.filter(x => x.descriptionKid).length,
    whySuccess: result.filter(x => x.whyImportantKid).length,
    summaryLengthMin: Math.min(...summaryLengths), summaryLengthMax: Math.max(...summaryLengths),
    summaryOutsideTarget: summaryLengths.filter(x => x < 30 || x > 60).length,
    descriptionSentenceMin: Math.min(...descriptionCounts), descriptionSentenceMax: Math.max(...descriptionCounts),
    descriptionOutsideTarget: descriptionCounts.filter(x => x < 2 || x > 4).length,
    difficult: difficult.map(x => x.name), sourceUnchanged: true,
  }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
