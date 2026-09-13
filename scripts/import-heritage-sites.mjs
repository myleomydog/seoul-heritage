import { readFile } from 'node:fs/promises';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DATA = new URL('../data/seoul-heritage-sites-kids.json', import.meta.url);
const COLLECTION = 'heritageSites';
const records = JSON.parse(await readFile(DATA, 'utf8'));

if (records.length !== 123) throw new Error(`안전 중단: 123건이 아니라 ${records.length}건입니다.`);
if (new Set(records.map(item => item.id)).size !== records.length) throw new Error('안전 중단: 중복 ID가 있습니다.');
if (records.some(item => !item.id || item.locationType !== '현장유산')) throw new Error('안전 중단: ID가 없거나 현장유산이 아닌 데이터가 있습니다.');
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error('GOOGLE_APPLICATION_CREDENTIALS에 Firebase 서비스 계정 JSON 경로를 설정하세요.');
}

initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID || undefined });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const batch = db.batch();
for (const item of records) batch.set(db.collection(COLLECTION).doc(item.id), item);
await batch.commit();
console.log(`${COLLECTION} 컬렉션에 ${records.length}건을 업로드했습니다.`);
