import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Landmark, MapPin, Search, X } from 'lucide-react';
import { loadHeritageSites } from './heritageData';
import './styles.css';

const DESIGNATIONS = ['전체', '국보', '보물', '사적', '명승', '천연기념물'];

function Filters({ query, setQuery, district, setDistrict, designation, setDesignation, districts }) {
  return <div className="filters-panel">
    <label className="search-field"><Search/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="이름으로 검색"/></label>
    <select value={district} onChange={event => setDistrict(event.target.value)} aria-label="자치구 선택">
      <option>전체 자치구</option>{districts.map(value => <option key={value}>{value}</option>)}
    </select>
    <select value={designation} onChange={event => setDesignation(event.target.value)} aria-label="지정종목 선택">
      {DESIGNATIONS.map(value => <option key={value}>{value}</option>)}
    </select>
  </div>;
}

function Card({ item, onOpen }) {
  return <button className="site-card" onClick={() => onOpen(item)}>
    <div className="site-image"><img src={item.imageUrl} alt="" loading="lazy" onError={event => event.currentTarget.closest('.site-image').classList.add('image-error')}/><span>이미지 없음</span></div>
    <div className="site-card-body"><div className="badges"><b>{item.designation}</b><span><MapPin/> {item.district}</span></div><h2>{item.name}</h2><p>{item.summaryKid}</p></div>
  </button>;
}

function Detail({ item, onClose }) {
  return <main className="detail-page">
    <button className="back-button" onClick={onClose}><ArrowLeft/> 목록으로</button>
    <article className="detail-card">
      <div className="detail-image"><img src={item.imageUrl} alt={`${item.name} 대표 이미지`}/></div>
      <div className="detail-content"><div className="badges"><b>{item.designation}</b><span><MapPin/> {item.district}</span></div><h1>{item.name}</h1><p className="address">{item.address}</p>
        <section className="summary"><h3>한 문장으로 보기</h3><p>{item.summaryKid}</p></section>
        <section><h3>쉽게 알아보기</h3><p>{item.descriptionKid}</p></section>
        <section><h3>왜 중요할까요?</h3><p>{item.whyImportantKid}</p></section>
      </div>
    </article>
  </main>;
}

function App() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const [district, setDistrict] = useState('전체 자치구');
  const [designation, setDesignation] = useState('전체');
  const [selected, setSelected] = useState(null);

  useEffect(() => { loadHeritageSites().then(result => { setItems(result.items); setSource(result.source); setStatus('ready'); }).catch(() => setStatus('error')); }, []);
  const districts = useMemo(() => [...new Set(items.map(item => item.district).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')), [items]);
  const filtered = useMemo(() => {
    const word = query.trim().toLowerCase();
    return items.filter(item => (district === '전체 자치구' || item.district === district) && (designation === '전체' || item.designation === designation) && (!word || item.name.toLowerCase().includes(word)));
  }, [items, query, district, designation]);

  if (selected) return <><Header/><Detail item={selected} onClose={() => setSelected(null)}/></>;
  return <><Header/><main className="app-main"><section className="intro"><p>서울 현장 국가유산</p><h1>우리 동네 국가유산 찾기</h1><span>서울에서 직접 만날 수 있는 국가유산 123개를 살펴보세요.</span></section>
    <Filters {...{ query, setQuery, district, setDistrict, designation, setDesignation, districts }}/>
    <div className="result-line"><b>{status === 'ready' ? `${filtered.length}개의 국가유산` : '데이터를 불러오는 중...'}</b><small>{source === 'firestore' ? 'Firestore 데이터' : source ? '로컬 데이터' : ''}</small></div>
    {status === 'error' ? <div className="state">데이터를 불러오지 못했습니다.</div> : status === 'loading' ? <div className="state">잠시만 기다려 주세요.</div> : filtered.length ? <div className="site-grid">{filtered.map(item => <Card key={item.id} item={item} onOpen={setSelected}/>)}</div> : <div className="state"><X/> 조건에 맞는 국가유산이 없어요.</div>}
  </main></>;
}

function Header() { return <header><div className="brand"><span className="brand-mark"><Landmark/></span><b>우리유산 탐험대</b></div><span className="header-note">초등 3·4학년 사회</span></header>; }

createRoot(document.getElementById('root')).render(<App/>);
