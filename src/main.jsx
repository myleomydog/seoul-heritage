import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Clock3, Landmark, MapPin, RotateCcw, Search, X } from 'lucide-react';
import { loadHeritageSites } from './heritageData';
import './styles.css';

const DESIGNATIONS = ['전체', '국보', '보물', '사적', '명승', '천연기념물'];
const ERAS = ['전체', '선사', '삼국', '통일신라', '조선', '대한제국', '일제강점기', '시대 미상'];

function eraOf(period = '') {
  const value = String(period).trim();
  if (!value) return '시대 미상';
  if (/신석기|선사|청동기/.test(value)) return '선사';
  if (/통일신라/.test(value)) return '통일신라';
  if (/삼국|백제|고구려|신라/.test(value)) return '삼국';
  if (/대한제국|광무|융희/.test(value)) return '대한제국';
  if (/일제강점기/.test(value)) return '일제강점기';
  const years = [...value.matchAll(/(?:^|[^0-9])(1[0-9]{3}|20[0-9]{2})(?=[^0-9]|$)/g)].map(match => Number(match[1]));
  if (years.some(year => year >= 1910 && year <= 1945)) return '일제강점기';
  if (years.some(year => year >= 1897 && year < 1910)) return '대한제국';
  if (/조선|태조|세종|인종|성종|연산군|광해군|인조|숙종|영조|정조|순조|고종/.test(value) || years.some(year => year >= 1392 && year < 1897)) return '조선';
  return '시대 미상';
}

function geometryPoints(geometry) {
  return geometry.type === 'Polygon' ? geometry.coordinates.flat() : geometry.coordinates.flat(2);
}

function SeoulMap({ selected, onSelect, counts }) {
  const [features, setFeatures] = useState([]);
  useEffect(() => {
    fetch('/assets/seoul-districts.geojson')
      .then(response => response.json())
      .then(data => setFeatures(data.features))
      .catch(console.error);
  }, []);
  const projection = useMemo(() => {
    const points = features.flatMap(feature => geometryPoints(feature.geometry));
    if (!points.length) return null;
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);
    const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    const project = ([x, y]) => [24 + (x - bounds.minX) / (bounds.maxX - bounds.minX) * 712, 20 + (bounds.maxY - y) / (bounds.maxY - bounds.minY) * 420];
    const path = geometry => {
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      return polygons.map(polygon => polygon.map(ring => ring.map((point, index) => `${index ? 'L' : 'M'}${project(point).join(',')}`).join(' ') + ' Z').join(' ')).join(' ');
    };
    const center = geometry => {
      const projected = geometryPoints(geometry).map(project);
      return [projected.reduce((sum, point) => sum + point[0], 0) / projected.length, projected.reduce((sum, point) => sum + point[1], 0) / projected.length];
    };
    return { path, center };
  }, [features]);
  if (!projection) return <div className="map-loading">서울 지도를 불러오는 중...</div>;
  return <div className="map-wrap"><svg className="seoul-map" viewBox="0 0 760 460" role="group" aria-label="서울특별시 25개 자치구 지도">
    {features.map(feature => {
      const name = feature.properties.name;
      const [x, y] = projection.center(feature.geometry);
      return <g key={name} className={`district ${selected === name ? 'selected' : ''}`} role="button" tabIndex="0" aria-label={`${name}, 현장 국가유산 ${counts[name] || 0}개`} onClick={() => onSelect(name)} onKeyDown={event => ['Enter', ' '].includes(event.key) && onSelect(name)}>
        <path d={projection.path(feature.geometry)}/><text x={x} y={y - 2}>{name}</text><text className="map-count" x={x} y={y + 12}>{counts[name] || 0}</text>
      </g>;
    })}
  </svg><small>구 경계를 누르면 해당 지역을 선택할 수 있어요.</small></div>;
}

function Timeline({ selected, onSelect, counts }) {
  return <section className="timeline-section"><div className="timeline-heading"><div><h2>시간을 따라 탐험해요</h2><p>시대별 국가유산을 눌러 보세요.</p></div></div><div className="timeline-scroll"><div className="timeline" role="list">
    {ERAS.map(era => <button key={era} className={`era-button ${selected === era ? 'active' : ''}`} onClick={() => onSelect(era)}><span className="era-node"/><span className="era-label">{era}</span><small className="era-count">{counts[era] || 0}개</small></button>)}
  </div></div></section>;
}

function Card({ item, onOpen }) {
  return <button className="site-card" onClick={() => onOpen(item)}><div className="site-image"><img src={item.imageUrl} alt="" loading="lazy" onError={event => event.currentTarget.closest('.site-image').classList.add('image-error')}/><span>이미지 없음</span></div><div className="site-card-body"><div className="badges"><b>{item.designation}</b><span><Clock3/> {eraOf(item.period)}</span></div><h2>{item.name}</h2><p>{item.summaryKid}</p></div></button>;
}

function Detail({ item, onClose }) {
  return <main className="detail-page"><button className="back-button" onClick={onClose}><ArrowLeft/> 목록으로</button><article className="detail-card"><div className="detail-image"><img src={item.imageUrl} alt={`${item.name} 대표 이미지`}/></div><div className="detail-content"><div className="badges"><b>{item.designation}</b><span><MapPin/> {item.district}</span></div><h1>{item.name}</h1><p className="address">{item.address}</p><section className="summary"><h3>한 문장으로 보기</h3><p>{item.summaryKid}</p></section><section><h3>쉽게 알아보기</h3><p>{item.descriptionKid}</p></section><section><h3>왜 중요할까요?</h3><p>{item.whyImportantKid}</p></section></div></article></main>;
}

function Header() { return <header><div className="brand"><span className="brand-mark"><Landmark/></span><b>서울 국가유산 탐험대</b></div><span className="header-note">초등 3·4학년 사회</span></header>; }

function App() {
  const [items, setItems] = useState([]), [status, setStatus] = useState('loading');
  const [district, setDistrict] = useState(''), [era, setEra] = useState('전체'), [designation, setDesignation] = useState('전체'), [query, setQuery] = useState(''), [selected, setSelected] = useState(null);
  useEffect(() => { loadHeritageSites().then(result => { setItems(result.items); setStatus('ready'); }).catch(() => setStatus('error')); }, []);
  const districtCounts = useMemo(() => items.reduce((acc, item) => (acc[item.district] = (acc[item.district] || 0) + 1, acc), {}), [items]);
  const baseForEra = useMemo(() => items.filter(item => (!district || item.district === district) && (designation === '전체' || item.designation === designation) && (!query.trim() || item.name.includes(query.trim()))), [items, district, designation, query]);
  const eraCounts = useMemo(() => ({ 전체: baseForEra.length, ...baseForEra.reduce((acc, item) => (acc[eraOf(item.period)] = (acc[eraOf(item.period)] || 0) + 1, acc), {}) }), [baseForEra]);
  const filtered = useMemo(() => baseForEra.filter(item => era === '전체' || eraOf(item.period) === era), [baseForEra, era]);
  const exploring = Boolean(district || era !== '전체' || designation !== '전체' || query.trim());
  const reset = () => { setDistrict(''); setEra('전체'); setDesignation('전체'); setQuery(''); };
  if (selected) return <><Header/><Detail item={selected} onClose={() => setSelected(null)}/></>;
  return <><Header/><main className="app-main"><section className="intro"><p>우리 지역 역사 여행</p><h1>서울 국가유산 탐험대</h1><span>지도를 누르고 우리 지역의 국가유산을 찾아보세요!</span></section>
    <section className="map-section"><div className="section-title"><h2>어느 지역의 국가유산을 탐험해 볼까요?</h2>{district ? <p>📍 <b>{district}</b>의 국가유산 <b>{districtCounts[district] || 0}개</b></p> : <p>서울 지도를 눌러 우리 지역의 국가유산을 찾아보세요!</p>}</div><SeoulMap selected={district} onSelect={setDistrict} counts={districtCounts}/></section>
    <Timeline selected={era} onSelect={setEra} counts={eraCounts}/>
    <section className="results"><div className="current-filter"><strong>{district ? `📍 ${district} · ` : ''}⏳ {era === '전체' ? '모든 시대' : `${era} 시대`} · {filtered.length}개의 국가유산</strong><button className="reset-button" onClick={reset}><RotateCcw/> 초기화</button></div>
      <div className="secondary-filters"><div className="designation-filters">{DESIGNATIONS.map(value => <button key={value} className={`filter-chip ${designation === value ? 'active' : ''}`} onClick={() => setDesignation(value)}>{value}</button>)}</div><label className="search-field"><Search/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="국가유산 이름 검색"/></label></div>
      {status === 'loading' ? <div className="state">데이터를 불러오는 중...</div> : status === 'error' ? <div className="state">데이터를 불러오지 못했습니다.</div> : !exploring ? <div className="state map-prompt">🗺️ <b>서울 지도를 눌러 우리 지역의 국가유산을 찾아보세요!</b></div> : !filtered.length ? <div className="state"><X/>현재 이 지역에서 찾은 국가유산이 없어요. 다른 지역도 탐험해 보세요!</div> : <div className="site-grid">{filtered.map(item => <Card key={item.id} item={item} onOpen={setSelected}/>)}</div>}
    </section></main></>;
}

createRoot(document.getElementById('root')).render(<App/>);
