import { readFile, writeFile, rename } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';

const DATA = new URL('../data/seoul-national-treasures.json', import.meta.url);
const TEMP = new URL('../data/seoul-national-treasures.json.tmp', import.meta.url);
const API = 'http://www.khs.go.kr/cha/SearchKindOpenapiDt.do';
const parser = new XMLParser({ trimValues: true, parseTagValue: false });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = value => value == null ? '' : String(value).trim();
const previousInstitution = /박물관|미술관|화장박물관|아트센터|대학교|여대|대학(?!로)|연구원|도서관|기념관|문화재단|문화원|학술원|문고/;
const rules = [
  ['미술관', /미술관|아트센터/],
  ['박물관', /박물관/],
  ['대학교', /대학교|여자대학|여대|대학(?!로)/],
  ['도서관·연구원', /도서관|연구원|규장각|학술원|문고/],
  ['사찰', /사찰|대한불교|조계종|(?:^|[\s,(])([가-힣]{2,12}(?:사|암))(?:[\s,)]|$)/],
  ['기타', /재단|법인|협회|공사|공단|관리소|관리단|유적본부|국립국악원|문화원|교회|성당|종중|문중|교육청/],
];

async function fetchDetail(item) {
  const query = new URLSearchParams({ ccbaKdcd: item.ccbaKdcd, ccbaAsno: item.ccbaAsno, ccbaCtcd: item.ccbaCtcd });
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(`${API}?${query}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      if (!xml.includes('<result')) throw new Error('XML result 요소 없음');
      return parser.parse(xml).result;
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        console.warn(`[retry ${attempt}/3] ${item.id}: ${error.message}`);
        await sleep(180 * 2 ** attempt);
      }
    } finally { clearTimeout(timer); }
  }
  throw new Error(`${item.id}: ${lastError?.message}`);
}

function holderTypeOf(value) {
  for (const [type, regex] of rules) if (regex.test(value)) return type;
  return '불명';
}

function institutionName(address, owner, admin) {
  for (const value of [admin, owner]) if (value && holderTypeOf(value) !== '불명') return value;
  const match = address.match(/([가-힣A-Za-z0-9·]+(?:박물관|미술관|아트센터|대학교|여자대학|연구원|도서관|기념관|학술원|문고|문화재단|문화원|사|암))(?:[\s,)])/);
  return match?.[1] || '';
}

function enrich(item, result) {
  const d = result.item || {};
  const ccbaPoss = text(d.ccbaPoss);
  const ccbaAdmin = text(d.ccbaAdmin);
  const evidence = `${item.address} ${ccbaPoss} ${ccbaAdmin}`;
  const holderType = holderTypeOf(evidence);
  const addressType = holderTypeOf(item.address);
  const hardInstitutionAddress = ['박물관', '미술관', '대학교', '도서관·연구원'].includes(addressType);
  const isMovableCandidate = item.category === '유물' || item.category === '기록유산';
  const isOriginalLocationCandidate = item.category === '유적건조물' && !hardInstitutionAddress;
  let locationType = '판별불가';
  if (isMovableCandidate && holderType !== '불명') locationType = '기관소장';
  else if (item.category === '유적건조물' && hardInstitutionAddress) locationType = '기관소장';
  else if (isOriginalLocationCandidate) locationType = '현장유산';
  return {
    ...item,
    gcodeName: text(d.gcodeName), bcodeName: text(d.bcodeName),
    mcodeName: text(d.mcodeName), scodeName: text(d.scodeName),
    ccbaMnm2: text(d.ccbaMnm2), ccbaQuan: text(d.ccbaQuan),
    ccbaPoss, ccbaAdmin, ccbaCncl: text(d.ccbaCncl),
    ccbaCndt: text(d.ccbaCndt), ccbaCpno: text(result.ccbaCpno),
    ccsiName: text(d.ccsiName), locationType, holderType,
    holdingInstitution: holderType === '불명' ? '' : institutionName(item.address, ccbaPoss, ccbaAdmin),
    isMovableCandidate, isOriginalLocationCandidate,
  };
}

async function mapLimited(items) {
  const output = new Array(items.length);
  let cursor = 0, completed = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      if (index) await sleep(180);
      output[index] = enrich(items[index], await fetchDetail(items[index]));
      completed += 1;
      if (completed % 50 === 0 || completed === items.length) console.log(`상세 재조회 ${completed}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker));
  return output;
}

function grouped(items, field) {
  return Object.entries(items.reduce((acc, item) => {
    acc[item[field]] = (acc[item[field]] || 0) + 1; return acc;
  }, {})).sort(([a], [b]) => a.localeCompare(b, 'ko'));
}

async function main() {
  const before = JSON.parse(await readFile(DATA, 'utf8'));
  if (before.length !== 928) throw new Error(`안전 중단: 기존 데이터가 928건이 아니라 ${before.length}건입니다.`);
  if (new Set(before.map(item => item.id)).size !== 928) throw new Error('안전 중단: 중복 ID가 있습니다.');
  const oldUnknown = new Set(before.filter(item => item.category !== '유적건조물' && !previousInstitution.test(item.address)).map(item => item.id));
  console.log(`기존 판별불가 기준: ${oldUnknown.size}건`);
  const after = await mapLimited(before);
  if (after.length !== before.length || after.some((item, i) => item.id !== before[i].id)) throw new Error('안전 중단: 항목 수 또는 순서가 변경되었습니다.');
  for (let i = 0; i < before.length; i += 1) {
    for (const field of ['name', 'imageUrl', 'descriptionOriginal', 'ccbaKdcd', 'ccbaAsno', 'ccbaCtcd']) {
      if (before[i][field] !== after[i][field]) throw new Error(`안전 중단: ${before[i].id}의 ${field}가 변경되었습니다.`);
    }
  }
  await writeFile(TEMP, `${JSON.stringify(after, null, 2)}\n`, 'utf8');
  await rename(TEMP, DATA);
  const resolved = after.filter(item => oldUnknown.has(item.id) && item.locationType !== '판별불가').length;
  console.log('\n=== 보강 결과 ===');
  grouped(after, 'locationType').forEach(([key, count]) => console.log(`${key}: ${count}`));
  console.log('holderType별 건수:');
  grouped(after, 'holderType').forEach(([key, count]) => console.log(`  ${key}: ${count}`));
  console.log(`기존 판별불가 ${oldUnknown.size}건 중 추가 분류: ${resolved}`);
  console.log(`기존 판별불가 중 여전히 판별불가: ${oldUnknown.size - resolved}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
