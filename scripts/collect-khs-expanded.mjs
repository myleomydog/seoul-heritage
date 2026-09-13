import { readFile, writeFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';

const SOURCE = new URL('../data/seoul-national-treasures.json', import.meta.url);
const OUTPUT = new URL('../data/seoul-heritage-expanded.json', import.meta.url);
const BASE = 'http://www.khs.go.kr/cha';
const SEOUL = '11';
const EXTRA = [{ code: '13', name: '사적' }, { code: '15', name: '명승' }, { code: '16', name: '천연기념물' }];
const parser = new XMLParser({ trimValues: true, parseTagValue: false });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const text = value => value == null ? '' : String(value).trim();
const numberOrNull = value => { const n = Number.parseFloat(text(value)); return Number.isFinite(n) ? n : null; };
const date = value => { const d = text(value).replace(/\D/g, ''); return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : text(value); };
const imageUrl = value => text(value).replace(/^http:\/\//, 'https://');
const holderRules = [
  ['미술관', /미술관|아트센터/], ['박물관', /박물관/],
  ['대학교', /대학교|여자대학|여대|대학(?!로)/],
  ['도서관·연구원', /도서관|연구원|규장각|학술원|문고/],
  ['사찰', /사찰|대한불교|조계종|(?:^|[\s,(])([가-힣]{2,12}(?:사|암))(?:[\s,)]|$)/],
  ['기타', /재단|법인|협회|공사|공단|관리소|관리단|유적본부|국립국악원|문화원|교회|성당|종중|문중|교육청/],
];

async function xml(endpoint, query) {
  const url = `${BASE}/${endpoint}?${new URLSearchParams(query)}`;
  let last;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      if (!body.includes('<result')) throw new Error('XML result 요소 없음');
      return parser.parse(body).result;
    } catch (error) {
      last = error;
      if (attempt < 4) { console.warn(`[retry ${attempt}/3] ${endpoint}: ${error.message}`); await sleep(180 * 2 ** attempt); }
    } finally { clearTimeout(timer); }
  }
  throw new Error(`${endpoint} 요청 실패: ${last?.message}`);
}

async function list({ code, name }) {
  const result = await xml('SearchKindOpenapiList.do', { pageUnit: 1000, pageIndex: 1, ccbaCtcd: SEOUL, ccbaKdcd: code });
  return array(result.item).filter(item => text(item.ccbaCtcd) === SEOUL && text(item.ccmaName) === name && text(item.ccbaCncl) !== 'Y');
}

function district(item, detail) {
  const direct = text(detail.ccsiName || item.ccsiName);
  if (/^[가-힣]+구$/.test(direct)) return direct;
  return text(detail.ccbaLcad).match(/(?:서울특별시|서울)\s+([가-힣]+구)(?:\s|$)/)?.[1] || '';
}

function holderTypeOf(value) {
  for (const [type, rule] of holderRules) if (rule.test(value)) return type;
  return '불명';
}

function holdingInstitution(address, owner, admin) {
  for (const value of [admin, owner]) if (value && holderTypeOf(value) !== '불명') return value;
  return address.match(/([가-힣A-Za-z0-9·]+(?:박물관|미술관|아트센터|대학교|여자대학|연구원|도서관|기념관|학술원|문고|문화재단|문화원|사|암))(?:[\s,)])/)?.[1] || '';
}

async function firstImage(ids) {
  const result = await xml('SearchImageOpenapi.do', ids);
  const candidates = array(result.item).flatMap(item => item?.item ? array(item.item) : [item]);
  return imageUrl(candidates.find(item => text(item?.imageUrl))?.imageUrl);
}

async function normalize(item) {
  const ids = { ccbaKdcd: text(item.ccbaKdcd), ccbaAsno: text(item.ccbaAsno), ccbaCtcd: text(item.ccbaCtcd) };
  const result = await xml('SearchKindOpenapiDt.do', ids);
  const d = result.item || {};
  const address = text(d.ccbaLcad);
  const itemDistrict = district(item, d);
  const ccbaPoss = text(d.ccbaPoss), ccbaAdmin = text(d.ccbaAdmin);
  const holderType = holderTypeOf(`${address} ${ccbaPoss} ${ccbaAdmin}`);
  const addressType = holderTypeOf(address);
  const institutionalAddress = ['박물관', '미술관', '대학교', '도서관·연구원'].includes(addressType);
  const category = text(d.gcodeName);
  const bcodeName = text(d.bcodeName);
  const isMovableCandidate = category === '유물' || category === '기록유산';
  const naturalSiteEvidence = category === '자연유산' && ['명승', '천연기념물'].includes(bcodeName) && Boolean(address && itemDistrict) && !institutionalAddress;
  const isOriginalLocationCandidate = (category === '유적건조물' && !institutionalAddress) || naturalSiteEvidence;
  let locationType = '판별불가';
  if (isMovableCandidate && holderType !== '불명') locationType = '기관소장';
  else if (category === '유적건조물' && institutionalAddress) locationType = '기관소장';
  else if (isOriginalLocationCandidate) locationType = '현장유산';
  let representative = imageUrl(d.imageUrl);
  if (!representative) { await sleep(180); try { representative = await firstImage(ids); } catch (error) { console.warn(`[image] ${text(d.ccbaMnm1)}: ${error.message}`); } }
  return {
    id: `${ids.ccbaKdcd}-${ids.ccbaAsno}-${ids.ccbaCtcd}`,
    name: text(d.ccbaMnm1 || item.ccbaMnm1), designation: text(d.ccmaName || item.ccmaName),
    region: '서울특별시', district: itemDistrict, category, period: text(d.ccceName), address,
    designatedDate: date(d.ccbaAsdt), descriptionOriginal: text(d.content), imageUrl: representative,
    latitude: numberOrNull(result.latitude ?? item.latitude), longitude: numberOrNull(result.longitude ?? item.longitude),
    ...ids, source: '국가유산청', gcodeName: category, bcodeName,
    mcodeName: text(d.mcodeName), scodeName: text(d.scodeName), ccbaMnm2: text(d.ccbaMnm2),
    ccbaQuan: text(d.ccbaQuan), ccbaPoss, ccbaAdmin, ccbaCncl: text(d.ccbaCncl),
    ccbaCndt: text(d.ccbaCndt), ccbaCpno: text(result.ccbaCpno), ccsiName: text(d.ccsiName),
    locationType, holderType,
    holdingInstitution: holderType === '불명' ? '' : holdingInstitution(address, ccbaPoss, ccbaAdmin),
    isMovableCandidate, isOriginalLocationCandidate,
  };
}

async function limited(items) {
  const output = new Array(items.length); let cursor = 0, completed = 0;
  async function worker() { while (cursor < items.length) { const i = cursor++; if (i) await sleep(180); output[i] = await normalize(items[i]); completed++; if (completed % 25 === 0 || completed === items.length) console.log(`추가 상세 ${completed}/${items.length}`); } }
  await Promise.all(Array.from({ length: 3 }, worker));
  return output;
}

function grouped(items, field) { return Object.entries(items.reduce((a, x) => (a[x[field] || '(빈 값)'] = (a[x[field] || '(빈 값)'] || 0) + 1, a), {})).sort(([a], [b]) => a.localeCompare(b, 'ko')); }

async function main() {
  const original = JSON.parse(await readFile(SOURCE, 'utf8'));
  if (original.length !== 928) throw new Error(`기존 데이터가 928건이 아닙니다: ${original.length}`);
  const extraList = [];
  for (const designation of EXTRA) { const items = await list(designation); console.log(`${designation.name} 활성 목록: ${items.length}`); extraList.push(...items); await sleep(180); }
  const additions = await limited(extraList);
  const seen = new Set(), duplicates = [];
  const expanded = [...original, ...additions].filter(item => { if (seen.has(item.id)) { duplicates.push(item.id); return false; } seen.add(item.id); return true; });
  expanded.sort((a, b) => a.district.localeCompare(b.district, 'ko') || a.designation.localeCompare(b.designation, 'ko') || a.name.localeCompare(b.name, 'ko'));
  await writeFile(OUTPUT, `${JSON.stringify(expanded, null, 2)}\n`, 'utf8');
  console.log('\n=== 확장 결과 ===');
  console.log(`전체: ${expanded.length}`);
  grouped(expanded, 'designation').forEach(([k, v]) => console.log(`${k}: ${v}`));
  grouped(expanded, 'locationType').forEach(([k, v]) => console.log(`${k}: ${v}`));
  console.log('현장유산 자치구별:');
  grouped(expanded.filter(x => x.locationType === '현장유산'), 'district').forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  const allDistricts = ['강남구','강동구','강북구','강서구','관악구','광진구','구로구','금천구','노원구','도봉구','동대문구','동작구','마포구','서대문구','서초구','성동구','성북구','송파구','양천구','영등포구','용산구','은평구','종로구','중구','중랑구'];
  const siteDistricts = new Set(expanded.filter(x => x.locationType === '현장유산').map(x => x.district));
  console.log(`현장유산 0건: ${allDistricts.filter(x => !siteDistricts.has(x)).join(', ')}`);
  console.log(`중복: ${duplicates.length}`);
  console.log(`자치구 판별 실패: ${expanded.filter(x => !x.district).length}`);
  console.log(`이미지 누락: ${expanded.filter(x => !x.imageUrl).length}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
