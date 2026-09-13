import { collection, getDocs } from 'firebase/firestore';
import localSites from '../data/seoul-heritage-sites-kids.json';
import { db, isFirebaseConfigured } from './firebase';

export async function loadHeritageSites() {
  if (!isFirebaseConfigured) return { items: localSites, source: 'local' };
  try {
    const snapshot = await getDocs(collection(db, 'heritageSites'));
    const items = snapshot.docs.map(document => ({ ...document.data(), id: document.id }));
    if (!items.length) throw new Error('heritageSites 컬렉션이 비어 있습니다.');
    return { items, source: 'firestore' };
  } catch (error) {
    console.error('Firestore 조회 실패, 로컬 데이터로 전환합니다.', error);
    return { items: localSites, source: 'local-fallback', error };
  }
}
