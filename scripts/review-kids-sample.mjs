import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('../data/seoul-heritage-sites-kids.json', import.meta.url);
const fixes = {
  '13-0002810000000-11': { whyImportantKid: '우리나라 건축가가 설계한 근대 초기의 학교 건물로, 당시 학교 건축을 살펴볼 수 있어요.' },
  '13-0002520000000-11': { whyImportantKid: '우리나라 초기 서양식 교회 건축의 모습을 보여 주며, 이후 교회 건축의 본보기가 되었어요.' },
  '12-0008180000000-11': { whyImportantKid: '창경궁의 생활 공간 가운데 특히 잘 남아 있어, 19세기 궁궐 건축을 연구하는 데 중요한 자료예요.' },
  '13-0001710000000-11': { whyImportantKid: '비석을 보호하는 건물은 20세기 초 전통 건축의 모습을 보여 주어 중요한 연구 자료가 돼요.' },
  '12-0011190000000-11': { whyImportantKid: '탑에 새겨진 기록 덕분에 조선 성종 원년인 1470년에 세웠다는 사실을 알 수 있어요.' },
  '12-0003830000000-11': {
    descriptionKid: '창덕궁 돈화문은 서울 종로구에 있는 보물이에요. 창덕궁의 정문으로 1412년에 세워졌고, 1609년에 고쳐 지었어요. 2층에는 종과 북을 두어 사람들에게 시간을 알렸다고 해요.',
    whyImportantKid: '지금까지 남아 있는 궁궐 대문 가운데 가장 오래된 나무 건물이라서 중요해요.',
  },
  '13-0002840000000-11': {
    descriptionKid: '구 서울역사는 서울 중구에 있는 사적이에요. 1925년에 경성역으로 완성되었고, 광복 뒤인 1947년에 서울역이 되었어요. 일제 강점기의 침탈 역사를 보여 주는 철도역 건물이에요.',
    whyImportantKid: '우리나라에서 가장 오래된 철도역 건물로, 당시 철도 건축과 역사를 살펴볼 수 있어요.',
  },
  '13-0002280000000-11': { whyImportantKid: '신라 진흥왕 때의 일을 새긴 귀중한 비석의 옛 자리로, 지금도 비석을 꽂았던 홈이 남아 있어요.' },
  '12-0017400000000-11': { whyImportantKid: '우리나라에서 별을 관측하는 기술이 어떻게 발전했는지 연구하는 데 귀중한 자료예요.' },
  '13-0001940000000-11': { whyImportantKid: '조선 시대 왕과 왕비의 무덤 모양과 주변에 놓은 여러 석물의 모습을 살펴볼 수 있어요.' },
};

const data = JSON.parse(await readFile(file, 'utf8'));
let changed = 0;
for (const item of data) {
  if (!fixes[item.id]) continue;
  Object.assign(item, fixes[item.id]);
  changed += 1;
}
if (changed !== Object.keys(fixes).length) throw new Error(`수정 대상 ${Object.keys(fixes).length}건 중 ${changed}건만 찾았습니다.`);
await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(`수정 완료: ${changed}건`);
