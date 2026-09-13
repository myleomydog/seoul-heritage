import { mkdir, writeFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';

const BASE_URL = 'http://www.khs.go.kr/cha';
const SEOUL_CODE = '11';
const DESIGNATIONS = [{ code: '11', name: '국보' }, { code: '12', name: '보물' }];
const PAGE_SIZE = 1000;
const CONCURRENCY = 3;
const REQUEST_GAP_MS = 180;
const MAX_RETRIES = 4;
const OUTPUT_PATH = new URL('../data/seoul-national-treasures.json', import.meta.url);
const parser = new XMLParser({ trimValues: true, parseTagValue: false });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const array = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const text = (value) => value == null ? '' : String(value).trim();
const numberOrNull = (value) => {
  const parsed = Number.parseFloat(text(value));
  return Number.isFinite(parsed) ? parsed : null;
};
const dateOrEmpty = (value) => {
  const digits = text(value).replace(/\D/g, '');
  return /^\d{8}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}` : text(value);
};
const normalizeUrl = (value) => text(value).replace(/^http:\/\//, 'https://');

async function requestXml(endpoint, query) {
  const url = `${BASE_URL}/${endpoint}?${new URLSearchParams(query)}`;
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      if (!xml.includes('<result')) throw new Error('예상한 XML result 요소가 없습니다.');
      return parser.parse(xml).result;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        console.warn(`[retry ${attempt}/${MAX_RETRIES - 1}] ${endpoint}: ${error.message}`);
        await sleep(REQUEST_GAP_MS * 2 ** attempt);
      }
    } finally { clearTimeout(timeout); }
  }
  throw new Error(`${endpoint} 요청 실패: ${lastError?.message}`);
}

async function collectList(designation) {
  const query = { pageUnit: PAGE_SIZE, pageIndex: 1, ccbaCtcd: SEOUL_CODE, ccbaKdcd: designation.code };
  const first = await requestXml('SearchKindOpenapiList.do', query);
  const total = Number.parseInt(text(first.totalCnt), 10) || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = array(first.item);
  for (let pageIndex = 2; pageIndex <= pages; pageIndex += 1) {
    await sleep(REQUEST_GAP_MS);
    const page = await requestXml('SearchKindOpenapiList.do', { ...query, pageIndex });
    items.push(...array(page.item));
  }
  return items.filter((item) => text(item.ccbaCtcd) === SEOUL_CODE && text(item.ccmaName) === designation.name && text(item.ccbaCncl) !== 'Y');
}

function districtFrom(item, detail) {
  const direct = text(detail.ccsiName || item.ccsiName);
  if (/^[가-힣]+구$/.test(direct)) return direct;
  const match = text(detail.ccbaLcad).match(/(?:서울특별시|서울)\s+([가-힣]+구)(?:\s|$)/);
  return match?.[1] || '';
}

async function collectImage(ids) {
  const result = await requestXml('SearchImageOpenapi.do', ids);
  const candidates = array(result.item).flatMap((item) => item?.item ? array(item.item) : [item]);
  return normalizeUrl(candidates.find((item) => text(item?.imageUrl))?.imageUrl);
}

async function normalizeItem(item) {
  const ids = { ccbaKdcd: text(item.ccbaKdcd), ccbaAsno: text(item.ccbaAsno), ccbaCtcd: text(item.ccbaCtcd) };
  const result = await requestXml('SearchKindOpenapiDt.do', ids);
  const detail = result.item || {};
  let imageUrl = normalizeUrl(detail.imageUrl);
  if (!imageUrl) {
    await sleep(REQUEST_GAP_MS);
    try { imageUrl = await collectImage(ids); }
    catch (error) { console.warn(`[image] ${text(item.ccbaMnm1)}: ${error.message}`); }
  }
  const address = text(detail.ccbaLcad);
  return {
    id: `${ids.ccbaKdcd}-${ids.ccbaAsno}-${ids.ccbaCtcd}`,
    name: text(detail.ccbaMnm1 || item.ccbaMnm1),
    designation: text(detail.ccmaName || item.ccmaName),
    region: '서울특별시', district: districtFrom(item, detail),
    category: text(detail.gcodeName), period: text(detail.ccceName), address,
    designatedDate: dateOrEmpty(detail.ccbaAsdt),
    descriptionOriginal: text(detail.content), imageUrl,
    latitude: numberOrNull(result.latitude ?? item.latitude),
    longitude: numberOrNull(result.longitude ?? item.longitude),
    ...ids, source: '국가유산청',
  };
}

async function mapLimited(items, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      if (index > 0) await sleep(REQUEST_GAP_MS);
      try { output[index] = await worker(items[index]); }
      catch (error) { console.error(`[failed] ${text(items[index].ccbaMnm1)}: ${error.message}`); }
      completed += 1;
      if (completed % 50 === 0 || completed === items.length) console.log(`상세 조회 ${completed}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
  return output.filter(Boolean);
}

function printStats(records, duplicateIds) {
  const byDistrict = records.reduce((counts, item) => {
    const key = item.district || '(판별 실패)';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const missingImages = records.filter((item) => !item.imageUrl);
  const missingDistricts = records.filter((item) => !item.district);
  const missingDescriptions = records.filter((item) => !item.descriptionOriginal);
  console.log('\n=== 수집 결과 ===');
  console.log(`전체 수집 건수: ${records.length}`);
  console.log(`국보 건수: ${records.filter((item) => item.designation === '국보').length}`);
  console.log(`보물 건수: ${records.filter((item) => item.designation === '보물').length}`);
  console.log('자치구별 건수:');
  Object.entries(byDistrict).sort(([a], [b]) => a.localeCompare(b, 'ko')).forEach(([key, count]) => console.log(`  ${key}: ${count}`));
  console.log(`이미지가 없는 국가유산: ${missingImages.length}`);
  missingImages.forEach((item) => console.log(`  - ${item.name} (${item.id})`));
  console.log(`descriptionOriginal이 없는 국가유산: ${missingDescriptions.length}`);
  missingDescriptions.forEach((item) => console.log(`  - ${item.name} (${item.id})`));
  console.log(`중복으로 발견된 국가유산: ${duplicateIds.length}`);
  duplicateIds.forEach((id) => console.log(`  - ${id}`));
  console.log(`district를 판별하지 못한 국가유산: ${missingDistricts.length}`);
  missingDistricts.forEach((item) => console.log(`  - ${item.name} | ${item.designation} | ${item.address} | ${item.ccbaKdcd} | ${item.ccbaAsno} | ${item.ccbaCtcd}`));
}

async function main() {
  console.log('국가유산청 목록을 조회합니다.');
  const lists = [];
  for (const designation of DESIGNATIONS) {
    const items = await collectList(designation);
    console.log(`${designation.name} 목록: ${items.length}건`);
    lists.push(...items);
    await sleep(REQUEST_GAP_MS);
  }
  const seen = new Set();
  const duplicateIds = [];
  const unique = lists.filter((item) => {
    const id = `${text(item.ccbaKdcd)}-${text(item.ccbaAsno)}-${text(item.ccbaCtcd)}`;
    if (seen.has(id)) { duplicateIds.push(id); return false; }
    seen.add(id); return true;
  });
  console.log(`상세 정보를 조회합니다 (동시 ${CONCURRENCY}개, 요청 간격 ${REQUEST_GAP_MS}ms).`);
  const records = await mapLimited(unique, normalizeItem);
  records.sort((a, b) => a.district.localeCompare(b.district, 'ko') || a.designation.localeCompare(b.designation, 'ko') || a.name.localeCompare(b.name, 'ko'));
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  printStats(records, duplicateIds);
  console.log(`JSON 파일: ${OUTPUT_PATH.pathname}`);
  if (records.length !== unique.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
