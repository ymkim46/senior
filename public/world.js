// 온라인 실버타운 — 3D 타운 (three.js)
import * as THREE from './vendor/three.module.min.js';

const $ = (id) => document.getElementById(id);
const DOW = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
// 시·도와 날씨를 물을 대표 좌표
const REGIONS = [['서울', 37.57, 126.98], ['부산', 35.18, 129.08], ['대구', 35.87, 128.6], ['인천', 37.46, 126.71], ['광주', 35.16, 126.85],
  ['대전', 36.35, 127.38], ['울산', 35.54, 129.31], ['세종', 36.48, 127.29], ['경기', 37.27, 127.01], ['강원', 37.88, 127.73], ['충북', 36.64, 127.49],
  ['충남', 36.6, 126.66], ['전북', 35.82, 127.15], ['전남', 34.82, 126.46], ['경북', 36.57, 128.73], ['경남', 35.23, 128.68], ['제주', 33.5, 126.53]];
const CLOTHES = [0xd9805f, 0x7f9fc9, 0xb98ac4, 0xe0a8b4, 0x8fae7a, 0xd8b45a, 0x6fa7a0, 0xc9886a];
const DEMO = new URLSearchParams(location.search).has('demo');

// ───────── 이 기기에 기억해 두는 것 ─────────
let store = {};
try { store = JSON.parse(localStorage.getItem('town') || '{}') || {}; } catch { store = {}; }
function save() { try { localStorage.setItem('town', JSON.stringify(store)); } catch { /* 저장이 막혀 있어도 그대로 씁니다 */ } }
if (!store.cid) { store.cid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); }
if (!Array.isArray(store.look)) store.look = [Math.floor(Math.random() * CLOTHES.length), Math.floor(Math.random() * 4)];
if (!Array.isArray(store.stamps)) store.stamps = [];
save();

// ───────── 시각 (한국 시간, 서버 시계에 맞춤) ─────────
let clockSkew = 0;
function kst() {
  const d = new Date(Date.now() + clockSkew + 9 * 3600e3);
  const o = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), dow: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
  o.min = o.hour * 60 + o.minute + d.getUTCSeconds() / 60;
  o.key = `${o.year}-${o.month}-${o.day}`;
  return o;
}
function clockText(min) {
  const h = Math.floor(min / 60) % 24, m = Math.floor(min % 60);
  const ap = h === 0 ? '밤' : h < 12 ? '오전' : h === 12 ? '낮' : '오후';
  return `${ap} ${h % 12 || 12}시${m ? ` ${m}분` : ''}`;
}
function after(mins) {
  mins = Math.max(1, Math.round(mins));
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h ? `${h}시간 ` : ''}${m ? `${m}분 ` : ''}뒤`;
}

let PLAN = [];
let simMin = null;        // 시험: 돌려 보는 시각
let demoWx = null;        // 시험: 날씨 바꿔 보기
let realWx = null;        // 내 동네의 지금 날씨 { kind, temp }
let mode = 'stay';
let soundOn = true;
let entered = false;
let today = kst();
const nowMin = () => (simMin === null ? kst().min : simMin);
function slot(min) {
  let cur = null, nxt = null;
  for (const p of PLAN) { if (min >= p.s && min < p.e) cur = p; else if (!nxt && p.s > min) nxt = p; }
  return { cur, nxt, scene: cur ? cur.scene : (min >= 1260 || min < 360) ? 'night' : 'free' };
}
function wxKind() {
  const k = demoWx || realWx?.kind || 'clear';
  if (k === 'rain' || k === 'storm') return 'rain';
  if (k === 'snow') return 'snow';
  if (k === 'cloudy' || k === 'fog') return 'cloud';
  return 'clear';
}

// ───────── 아래 글씨와 소리 ─────────
let lastTitle = null, lastMinKey = -1, actx = null, lastSay = '';
function chime() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    [660, 880].forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.35;
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 1.3);
    });
  } catch { /* 소리를 못 내는 기기 */ }
}
function speak(text, onEnd) {
  try {
    if (!('speechSynthesis' in window)) return false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.rate = 0.85;
    if (onEnd) u.onend = onEnd;
    speechSynthesis.speak(u);
    return true;
  } catch { return false; }
}
// 아래 글씨 칸: 보여 주고 읽어 준 다음 스스로 사라집니다. 시계 단추를 누르면 다시 나옵니다.
let capTimer = 0;
function hideCaption() { clearTimeout(capTimer); $('caption').hidden = true; }
function announce(text, chimeFirst = true) {
  clearTimeout(capTimer); $('caption').hidden = false;
  capTimer = setTimeout(hideCaption, soundOn ? 40000 : 12000); // 읽기가 끝났다는 신호를 못 받는 기기를 위한 여유
  if (!soundOn) return;
  if (chimeFirst) chime();
  setTimeout(() => speak(text, () => { clearTimeout(capTimer); capTimer = setTimeout(hideCaption, 2500); }), chimeFirst ? 900 : 0);
}
function wxText() {
  if (!realWx || demoWx) return '';
  const word = { clear: '맑아요', partly: '구름이 조금 있어요', cloudy: '흐려요', fog: '안개가 꼈어요', rain: '비가 와요', storm: '천둥 치고 비가 와요', snow: '눈이 와요' }[realWx.kind] || '맑아요';
  const k = wxKind(), t = realWx.temp;
  const tip = k === 'rain' ? '나가실 땐 우산을 챙기세요.' : k === 'snow' ? '길이 미끄러우니 천천히 걸으세요.'
    : t <= 5 ? '많이 추우니 두꺼운 겉옷을 입으세요.' : t <= 12 ? '바람이 차니 겉옷을 챙기세요.' : t >= 30 ? '더우니 물을 자주 드세요.' : '';
  return `지금 ${store.regionName || '우리 동네'}는 ${word}. ${t}도예요. ${tip}`.trim();
}
function paintCaption(force) {
  const min = nowMin(), key = Math.floor(min);
  if (!force && key === lastMinKey) return;
  lastMinKey = key;
  const s = slot(min);
  const title = s.cur ? s.cur.announce : s.scene === 'night' ? '주무실 시간이에요' : '쉬는 시간이에요';
  $('when').textContent = `${DOW[today.dow]} · ${today.month}월 ${today.day}일 · ${clockText(min)}${simMin === null ? '' : ' (돌려 보는 중)'}`;
  $('now').textContent = title;
  $('next').textContent = s.nxt ? `다음은 ${clockText(s.nxt.s)} ${s.nxt.title}, ${after(s.nxt.s - min)}예요.` : '내일 아침 7시에 아침 인사로 다시 만나요.';
  lastSay = s.cur ? s.cur.say : s.scene === 'night' ? '지배인이 밤새 현관을 지키고 있어요.' : '지배인: 창가에 앉아 정원 구경하세요.';
  $('say').textContent = lastSay;
  $('wx').textContent = wxText();
  $('caption').classList.toggle('meal', !!(s.cur && s.cur.meal));
  $('clock-chip').textContent = `🕘 ${clockText(min)}`;
  if (entered && lastTitle !== null && title !== lastTitle) announce(`${title}. ${lastSay}`);
  lastTitle = title;
}
const fullStatus = () => `오늘은 ${today.month}월 ${today.day}일 ${DOW[today.dow]}입니다. 지금은 ${clockText(nowMin())}입니다. ${$('now').textContent}. ${$('next').textContent} ${wxText()}`;

// ───────── 3D 장면 ─────────
const cv = $('cv'), stage = $('stage');
let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' }); } catch { renderer = null; }
const small = Math.min(window.innerWidth, window.innerHeight) < 600;
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
scene.background = new THREE.Color(0x9ccdf0);
scene.fog = new THREE.Fog(0x9ccdf0, 60, 240);
if (renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
}

const mats = new Map();
function M(c) { let m = mats.get(c); if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); mats.set(c, m); } return m; }
function add(geo, m, x, y, z, parent) {
  const mesh = new THREE.Mesh(geo, typeof m === 'number' ? M(m) : m);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  (parent || scene).add(mesh); return mesh;
}
const box = (w, h, d, c, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), c, x, y, z, parent);
const cyl = (r1, r2, h, c, x, y, z, parent, seg = 16) => add(new THREE.CylinderGeometry(r1, r2, h, seg), c, x, y, z, parent);
const ball = (r, c, x, y, z, parent) => add(new THREE.SphereGeometry(r, 14, 10), c, x, y, z, parent);
function flat(geo, c, x, y, z) { const m = add(geo, c, x, y, z); m.rotation.x = -Math.PI / 2; m.castShadow = false; return m; }
let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

const C = { oak: 0xd2a871, wood: 0xb98d5c, walnut: 0x6b4a2e, cream: 0xf3eadb, floor: 0xcfae82, stone: 0xdccfb9,
  sage: 0x9aab84, sageDeep: 0x7f9670, coral: 0xe0907a, leaf: 0x5f9a4e, leafDark: 0x3f7a45 };
const FY = 0.15, WH = 4.2;
const season = Math.floor((today.month % 12) / 3); // 0 겨울 1 봄 2 여름 3 가을
const groundBase = new THREE.Color([0xa9b08a, 0x86bf63, 0x62a84e, 0x9aa85a][season]);
const groundMat = new THREE.MeshLambertMaterial({ color: groundBase });
const pathMat = new THREE.MeshLambertMaterial({ color: C.stone });
const white = new THREE.Color(0xffffff);

// 땅, 길, 먼 산
flat(new THREE.PlaneGeometry(600, 600), groundMat, 0, 0, 0);
flat(new THREE.RingGeometry(2.7, 4.7, 48), pathMat, 0, 0.03, 6);
{ const a = flat(new THREE.PlaneGeometry(2.6, 3.7), pathMat, 0, 0.03, -0.3); a.receiveShadow = true;
  flat(new THREE.PlaneGeometry(2.6, 6.6), pathMat, 0, 0.03, 13.9);
  flat(new THREE.PlaneGeometry(5.4, 2.2), pathMat, 7, 0.03, 6.6); }
[[-90, -170, 80, 0x4f7f5f], [40, -190, 110, 0x3f6f55], [150, -165, 70, 0x5a8a66], [-170, -120, 60, 0x5a8a66], [190, -90, 60, 0x4f7f5f]].forEach((h) => {
  const m = ball(h[2], h[3], h[0], -h[2] * 0.22, h[1]); m.scale.y = 0.62; m.castShadow = false;
});

// 꽃과 덤불은 한 덩어리로 묶어 그립니다 (느린 기기를 위해)
const blobs = []; // [x, y, z, 크기, 색]
const HYD = [0x9db4e6, 0xf0a8c0, 0xf6f3ea, 0xb9a0e0, 0x8fc3e8, 0xf4c2d2];
function hydrangea(x, z, s = 1) {
  blobs.push([x, 0.32 * s, z, 0.55 * s, C.leafDark]);
  if (season === 0) return;
  const fam = HYD[Math.floor(rnd() * 3) * 2 % HYD.length], n = 6 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.28, r = rnd() * 0.42 * s;
    blobs.push([x + Math.cos(a) * r, (0.5 + rnd() * 0.32) * s, z + Math.sin(a) * r, (0.17 + rnd() * 0.07) * s, rnd() < 0.75 ? fam : HYD[Math.floor(rnd() * HYD.length)]]);
  }
}
function bed(x0, z0, x1, z1, n) { for (let i = 0; i < n; i++) hydrangea(x0 + (x1 - x0) * (i + rnd() * 0.6) / n, z0 + (z1 - z0) * (i + rnd() * 0.6) / n + (rnd() - 0.5) * 0.5, 0.85 + rnd() * 0.4); }
const leafCol = [0x8d7a66, 0xa9d48a, 0x5fa24e, 0xd9963a][season];
function tree(x, z, s = 1) {
  cyl(0.2 * s, 0.34 * s, 3.4 * s, 0x6b4a36, x, 1.7 * s, z, null, 8);
  if (season === 0) { [0.5, -0.6, 0.15].forEach((r) => { const m = cyl(0.05, 0.1, 2.2 * s, 0x6b4a36, x + r, 3.9 * s, z, null, 6); m.rotation.z = -r; }); return; }
  [[0, 4.4, 0, 1.9], [-1.3, 3.8, 0.5, 1.35], [1.2, 3.9, -0.4, 1.45], [-0.2, 5.4, -0.2, 1.25], [0.5, 4.2, 1.1, 1.2]].forEach((f) => {
    const m = ball(f[3] * s, leafCol, x + f[0] * s, f[1] * s, z + f[2] * s); m.scale.y = 0.85;
  });
}
function pine(x, z, s = 1) {
  cyl(0.16 * s, 0.24 * s, 1.6 * s, 0x6b4a36, x, 0.8 * s, z, null, 8);
  [[1.7, 2.2, 2], [1.3, 2, 3.2], [0.9, 1.8, 4.3]].forEach((c) => add(new THREE.ConeGeometry(c[0] * s, c[1] * s, 10), 0x2f6a45, x, c[2] * s, z));
}
function bench(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  box(2.2, 0.1, 0.6, C.wood, 0, 0.48, 0, g); box(2.2, 0.55, 0.08, C.wood, 0, 0.85, -0.28, g);
  [-0.95, 0.95].forEach((lx) => box(0.1, 0.48, 0.55, C.walnut, lx, 0.24, 0, g));
}

// 정원
tree(-13.5, 2.5, 1.05); tree(13.8, 1, 1.1); tree(-15, 13, 0.95); tree(14.5, 13.5, 1); tree(4.4, 12.2, 0.8);
pine(-16.5, -6); pine(16.5, -8, 1.1); pine(-17, 8, 0.9);
bed(-10.5, -1.6, -2.2, -1.6, 9); bed(2.2, -1.6, 10.5, -1.6, 9);                       // 건물 앞
bed(-1.8, 6, 1.8, 6, 4); hydrangea(0, 5, 1.2); hydrangea(-0.6, 7.2, 1); hydrangea(0.9, 7, 1); // 가운데 꽃섬
bed(-2.6, 12.2, -2.6, 16.5, 5); bed(2.6, 12.6, 2.6, 16.5, 5);                           // 대문 길
bed(-12, -15.6, 12, -15.6, 16); bed(-13, -17.4, 13, -17.4, 12);                         // 창밖 뒤뜰
tree(-8, -20, 1.1); tree(1, -22, 1.2); tree(9.5, -20.5, 1); pine(-15, -19, 1.2); pine(15.5, -21, 1.2);
bench(-3.9, 2.2, 0.5); bench(4, 11, Math.PI + 0.4);
bed(-15.2, 8.5, -15.2, 15.5, 7); bed(-14, 16.2, -3.6, 16.2, 9); bed(3.6, 16.2, 14, 16.2, 9); bed(15.2, 9.5, 15.2, 15.5, 6); // 울타리 안쪽
{ // 퍼걸러와 덩굴장미
  const px = 10, pz = 6.6;
  [[-1.6, -1.4], [1.6, -1.4], [-1.6, 1.4], [1.6, 1.4]].forEach((p) => box(0.22, 2.7, 0.22, C.wood, px + p[0], 1.35, pz + p[1]));
  [-1.4, 1.4].forEach((dz) => box(4, 0.18, 0.2, C.wood, px, 2.8, pz + dz));
  for (let i = -3; i <= 3; i++) box(0.14, 0.14, 3.6, C.wood, px + i * 0.55, 2.95, pz);
  for (let i = 0; i < 26; i++) blobs.push([px + (rnd() - 0.5) * 3.8, 3.05 + rnd() * 0.2, pz + (rnd() - 0.5) * 3.4, 0.22 + rnd() * 0.12, season === 0 ? C.leafDark : rnd() < 0.5 ? C.leaf : rnd() < 0.5 ? 0xf2a6bd : 0xf8dbe3]);
  bench(px, pz - 0.9, 0); cyl(0.5, 0.5, 0.06, C.walnut, px, 0.6, pz + 0.3); cyl(0.07, 0.2, 0.6, C.walnut, px, 0.3, pz + 0.3);
}
[[-11, 3.4], [-11, 6.6]].forEach((p, k) => { // 텃밭 상자
  box(1.5, 0.55, 2.6, C.wood, p[0], 0.28, p[1]); box(1.3, 0.1, 2.4, 0x5a4634, p[0], 0.56, p[1]);
  for (let i = 0; i < 9; i++) blobs.push([p[0] + (rnd() - 0.5) * 1, 0.72 + rnd() * 0.1, p[1] + (rnd() - 0.5) * 2.1, 0.2 + rnd() * 0.08, season === 0 ? 0x8d8a6a : (k && rnd() < 0.4) ? 0xa58bd0 : C.leaf]);
});
[[-16.4, 1], [16.4, 1]].forEach((p) => box(0.7, 0.9, 32, C.leafDark, p[0], 0.45, p[1]));       // 울타리
[[-9.4, 17.2], [9.4, 17.2]].forEach((p) => box(13.4, 0.9, 0.7, C.leafDark, p[0], 0.45, p[1]));
const lampMat = new THREE.MeshLambertMaterial({ color: 0xfff0cc, emissive: 0xffc46a, emissiveIntensity: 0 });
[[-1.7, 1.2], [1.7, 1.2], [-1.7, 11.4], [1.7, 11.4], [5, 5.2], [-5, 5.2]].forEach((p) => { cyl(0.07, 0.07, 0.6, 0x4a4f55, p[0], 0.3, p[1], null, 8); cyl(0.11, 0.11, 0.2, lampMat, p[0], 0.7, p[1], null, 8).castShadow = false; });

// 큰 홀: 바닥, 벽, 유리창, 기둥, 들보
const floorCv = document.createElement('canvas'); floorCv.width = 512; floorCv.height = 512;
{ const c = floorCv.getContext('2d'); c.fillStyle = '#d3ad7c'; c.fillRect(0, 0, 512, 512);
  for (let r = 0; r < 8; r++) { const y = r * 64, off = (r % 2) * 128;
    for (let k = -1; k < 3; k++) { const x = off + k * 256; c.fillStyle = ['#d8b384', '#cda571', '#d5ae7d', '#c99f6b'][(r + k + 4) % 4]; c.fillRect(x + 1, y + 1, 254, 62); }
    c.strokeStyle = 'rgba(120,80,40,.10)'; for (let g = 0; g < 5; g++) { c.beginPath(); c.moveTo(0, y + 8 + g * 12 + Math.sin(r + g) * 3); c.lineTo(512, y + 10 + g * 12 + Math.cos(r * g) * 3); c.stroke(); } } }
const floorTex = new THREE.CanvasTexture(floorCv); floorTex.colorSpace = THREE.SRGBColorSpace; floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(7, 4); floorTex.anisotropy = 4;
box(22.6, FY, 11.5, new THREE.MeshLambertMaterial({ map: floorTex }), 0, FY / 2, -8.5);
box(8, 0.08, 1.2, C.stone, 0, 0.04, -2.3);
const wallMat = new THREE.MeshLambertMaterial({ color: C.cream, emissive: 0x7a5a2a, emissiveIntensity: 0 });
box(0.3, WH, 11.2, wallMat, -11.15, FY + WH / 2, -8.5); box(0.3, WH, 11.2, wallMat, 11.15, FY + WH / 2, -8.5);
for (let x = -11; x <= 11.01; x += 2.2) box(0.14, WH, 0.14, 0x7a5a3a, x, FY + WH / 2, -14.1);
box(22.2, 0.16, 0.16, 0x7a5a3a, 0, FY + 2.9, -14.1);
{ const g = new THREE.Mesh(new THREE.PlaneGeometry(22.2, WH), new THREE.MeshBasicMaterial({ color: 0xcfeaf7, transparent: true, opacity: 0.1, depthWrite: false })); g.position.set(0, FY + WH / 2, -14.12); scene.add(g); }
box(5.6, WH, 0.3, C.wood, 0, FY + WH / 2, -13.7);
for (let x = -2.6; x <= 2.61; x += 0.4) box(0.12, WH, 0.1, 0x9a7144, x, FY + WH / 2, -13.5);
[-11, 11].forEach((x) => box(0.36, WH, 0.36, C.oak, x, FY + WH / 2, -3.1));

const roofG = new THREE.Group(); scene.add(roofG);
// 천장과 들보, 기와지붕 — 위에서 내려다볼 때는 걷혀서 안이 보입니다
{ const nc = (m) => { m.castShadow = false; return m; };
  const ceil = nc(add(new THREE.PlaneGeometry(22.4, 11.2), new THREE.MeshLambertMaterial({ color: 0xf6efe2, side: THREE.DoubleSide }), 0, FY + WH + 0.32, -8.6, roofG)); ceil.rotation.x = Math.PI / 2; ceil.receiveShadow = false;
  [-4.4, -6.5, -8.6, -10.7, -12.8].forEach((z) => nc(box(22.4, 0.26, 0.3, C.oak, 0, FY + WH + 0.17, z, roofG)));
  [-11.15, -5.6, 0, 5.6, 11.15].forEach((x) => nc(box(0.3, 0.3, 11.3, C.oak, x, FY + WH + 0.15, -8.6, roofG)));
  nc(box(22.8, 0.34, 0.34, C.oak, 0, FY + WH + 0.15, -14.1, roofG)); nc(box(22.8, 0.34, 0.34, C.oak, 0, FY + WH + 0.15, -3.1, roofG));
  nc(box(24.6, 0.22, 13.4, 0x5a4a40, 0, FY + WH + 0.5, -8.6, roofG));
  const hip = new THREE.Group(); hip.position.set(0, FY + WH + 1.5, -8.6); hip.scale.set(17.4, 1.8, 9.5); roofG.add(hip);
  const cone = nc(add(new THREE.ConeGeometry(1, 1, 4), 0x6b5a4e, 0, 0, 0, hip)); cone.rotation.y = Math.PI / 4; }
const shadeMat = new THREE.MeshLambertMaterial({ color: 0xfff3dc, emissive: 0xffd08a, emissiveIntensity: 0.15 });
const lamps = [[-7, -7.6], [0, -7.6], [6.6, -7.6]].map((p) => {
  box(0.03, 1.1, 0.03, 0x555555, p[0], FY + WH - 0.4, p[1], roofG).castShadow = false;
  cyl(0.5, 0.6, 0.32, shadeMat, p[0], FY + WH - 1.05, p[1], roofG, 20).castShadow = false;
  const l = new THREE.PointLight(0xffc98a, 0, 16, 1.6); l.position.set(p[0], FY + WH - 1.3, p[1]); scene.add(l); return l;
});

for (let x = -9.9; x <= 9.91; x += 4.4) if (Math.abs(x) > 3) box(0.5, WH - 0.2, 0.16, 0xf1e7d6, x, FY + WH / 2, -13.9).castShadow = false; // 커튼
{ const tl = new THREE.TextureLoader();
  [['/img/lounge.jpg', -10.98, -4.6, 1], ['/img/garden.jpg', 10.98, -5, -1], ['/img/dining.jpg', 10.98, -12.6, -1]].forEach((f) => {
    const t = tl.load(f[0]); t.colorSpace = THREE.SRGBColorSpace;
    const fr = box(0.08, 1.5, 2.5, C.walnut, f[1], FY + 2.3, f[2]); fr.castShadow = false;
    const pm = add(new THREE.PlaneGeometry(2.3, 1.3), new THREE.MeshBasicMaterial({ map: t }), f[1] + f[3] * 0.05, FY + 2.3, f[2]); pm.rotation.y = f[3] * Math.PI / 2; pm.castShadow = false;
  }); }
// 벽시계와 일력
const clock = new THREE.Group(); clock.position.set(-1.35, FY + 2.95, -13.42); scene.add(clock);
{ const a = add(new THREE.CircleGeometry(0.66, 36), C.walnut, 0, 0, 0, clock); a.castShadow = false;
  const b = add(new THREE.CircleGeometry(0.57, 36), new THREE.MeshBasicMaterial({ color: 0xfffdf5 }), 0, 0, 0.01, clock); b.castShadow = false;
  for (let k = 0; k < 12; k++) { const an = k / 12 * Math.PI * 2; const t = add(new THREE.BoxGeometry(0.035, k % 3 ? 0.07 : 0.14, 0.01), new THREE.MeshBasicMaterial({ color: 0x222222 }), Math.sin(an) * 0.47, Math.cos(an) * 0.47, 0.02, clock); t.rotation.z = -an; t.castShadow = false; } }
function hand(len, w) { const g = new THREE.BoxGeometry(w, len, 0.01); g.translate(0, len / 2, 0); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x111111 })); m.position.z = 0.03; clock.add(m); return m; }
const hHand = hand(0.29, 0.06), mHand = hand(0.43, 0.04);
const calCv = document.createElement('canvas'); calCv.width = 256; calCv.height = 340;
const calTex = new THREE.CanvasTexture(calCv); calTex.colorSpace = THREE.SRGBColorSpace;
function drawCal() {
  const c = calCv.getContext('2d');
  c.fillStyle = '#fffdf5'; c.fillRect(0, 0, 256, 340);
  c.fillStyle = '#c04f35'; c.fillRect(0, 0, 256, 70);
  c.textAlign = 'center'; c.fillStyle = '#fff'; c.font = '700 44px "Noto Sans KR",sans-serif'; c.fillText(`${today.month}월`, 128, 52);
  c.fillStyle = today.dow === 0 ? '#c04f35' : '#16241e'; c.font = '700 170px "Noto Sans KR",sans-serif'; c.fillText(today.day, 128, 232);
  c.font = '700 50px "Noto Sans KR",sans-serif'; c.fillText(DOW[today.dow], 128, 305);
  calTex.needsUpdate = true;
}
drawCal();
document.fonts?.ready.then(drawCal);
add(new THREE.PlaneGeometry(1.2, 1.6), new THREE.MeshBasicMaterial({ map: calTex }), 1.35, FY + 2.75, -13.42).castShadow = false;

// 가구
const SEATS = { lounge: [], dining: [], craft: [], music: [] };
function armchair(x, z, fx, fz, col, list) {
  const g = new THREE.Group(); g.position.set(x, FY, z); g.rotation.y = Math.atan2(fx - x, fz - z); scene.add(g);
  box(0.82, 0.24, 0.78, col, 0, 0.42, 0, g); box(0.82, 0.62, 0.18, col, 0, 0.8, -0.32, g);
  [-0.44, 0.44].forEach((ax) => { box(0.07, 0.07, 0.8, C.wood, ax, 0.66, 0, g); box(0.07, 0.66, 0.07, C.wood, ax, 0.33, 0.36, g); box(0.07, 0.66, 0.07, C.wood, ax, 0.33, -0.36, g); });
  list?.push({ x, z, fx, fz });
}
function chair(x, z, fx, fz, col, list) {
  const g = new THREE.Group(); g.position.set(x, FY, z); g.rotation.y = Math.atan2(fx - x, fz - z); scene.add(g);
  box(0.52, 0.09, 0.5, col, 0, 0.46, 0, g); box(0.52, 0.5, 0.07, C.oak, 0, 0.78, -0.24, g);
  [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]].forEach((l) => box(0.05, 0.44, 0.05, C.oak, l[0], 0.22, l[1], g));
  list?.push({ x, z, fx, fz });
}
function vase(x, y, z, col) { cyl(0.09, 0.07, 0.2, 0xe8eef0, x, y + 0.1, z, null, 10); [[0, 0.3, 0], [0.1, 0.26, 0.06], [-0.09, 0.27, -0.05]].forEach((f) => blobs.push([x + f[0], y + f[1], z + f[2], 0.11, season === 0 ? 0xf6f3ea : col])); }
function roundSet(cx, cz, n, r, list, cols, big) {
  const top = big ? 0.78 : 0.6;
  cyl(big ? 1.15 : 0.55, big ? 1.15 : 0.55, 0.07, big ? C.oak : C.walnut, cx, FY + top, cz, null, 28);
  cyl(big ? 0.28 : 0.1, big ? 0.4 : 0.26, top, big ? C.oak : C.walnut, cx, FY + top / 2, cz, null, 12);
  vase(cx, FY + top + 0.04, cz, 0xf0a8c0);
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + 0.4; (big ? chair : armchair)(cx + Math.sin(a) * r, cz + Math.cos(a) * r, cx, cz, cols[i % cols.length], list); }
}
// 라운지 (왼쪽): 책장과 안락의자
box(0.5, 3.3, 7.4, C.wood, -10.7, FY + 1.65, -9);
[0.9, 1.7, 2.5].forEach((y) => box(0.52, 0.06, 7.2, C.oak, -10.68, FY + y, -9).castShadow = false);
const books = [];
for (let s = 0; s < 4; s++) for (let i = 0; i < 26; i++) if (rnd() < 0.8) books.push([-10.4, FY + 0.28 + s * 0.8 + 0.02, -12.4 + i * 0.27, [0x7f9670, 0xc9886a, 0xe8dcc0, 0x6f8fb0, 0xb86a5a, 0xd8b45a][Math.floor(rnd() * 6)], 0.4 + rnd() * 0.2]);
roundSet(-7.3, -10.1, 3, 1.35, SEATS.lounge, [C.sage, C.coral, C.sage]);
roundSet(-6.7, -5.9, 3, 1.35, SEATS.lounge, [C.coral, C.sage, C.coral]);
{ const r = flat(new THREE.CircleGeometry(2.3, 32), 0xe6d8c2, -7.3, FY + 0.012, -10.1); r.receiveShadow = true; }
// 식당 (오른쪽): 둥근 식탁과 조리대
roundSet(5.4, -9.9, 6, 1.7, SEATS.dining, [C.sage, 0xe8b4a6], true);
roundSet(7.7, -5.6, 6, 1.7, SEATS.dining, [0xe8b4a6, C.sage], true);
box(0.9, 1, 6.6, C.sageDeep, 10.4, FY + 0.5, -9.4); box(1, 0.07, 6.8, 0xf4efe6, 10.38, FY + 1.03, -9.4);
[[-11.6, 0xe8eef0], [-10.4, 0xd9805f], [-8.2, 0xe8eef0]].forEach((p) => cyl(0.16, 0.12, 0.26, p[1], 10.4, FY + 1.2, p[0], null, 10));
// 공방 탁자 (가운데 앞)
box(4.9, 0.1, 1.5, C.oak, 0, FY + 0.78, -5.6); [-1.7, 1.7].forEach((x) => box(0.5, 0.74, 1.1, C.oak, x, FY + 0.37, -5.6));
for (let i = 0; i < 4; i++) { const x = -1.65 + i * 1.1; chair(x, -6.65, x, -5.6, i % 2 ? C.sage : 0xe8b4a6, SEATS.craft); chair(x, -4.55, x, -5.6, i % 2 ? 0xe8b4a6 : C.sage, SEATS.craft); }
[[-1.5, -5.4], [-0.3, -5.8], [0.9, -5.35], [1.7, -5.85]].forEach((p, i) => { box(0.5, 0.012, 0.36, 0xfffdf8, p[0], FY + 0.84, p[1]).castShadow = false; blobs.push([p[0], FY + 0.87, p[1], 0.09, HYD[i % HYD.length]]); });
[[-0.9, 0xd9805f], [0.25, 0x7f9fc9], [1.25, 0xd8b45a]].forEach((p) => cyl(0.07, 0.06, 0.13, p[1], p[0], FY + 0.9, -5.6, null, 8));
vase(0, FY + 0.83, -5.55, 0x9db4e6);
// 음악 자리 (가운데 뒤): 피아노와 감상 의자
{ const px = 1.9, pz = -11.5, pc = 0x3a2416;
  box(2, 0.36, 1.5, pc, px, FY + 0.98, pz); box(0.26, 0.07, 1.3, 0xfaf7ee, px - 1.08, FY + 0.92, pz); box(0.3, 0.1, 1.5, pc, px - 1.08, FY + 0.84, pz);
  const lid = box(1.9, 0.05, 1.45, pc, px + 0.05, FY + 1.5, pz - 0.5); lid.rotation.x = -0.7;
  [[-0.8, -0.6], [-0.8, 0.6], [0.85, 0]].forEach((l) => cyl(0.07, 0.05, 0.8, pc, px + l[0], FY + 0.4, pz + l[1], null, 8));
  box(0.6, 0.1, 0.42, 0x5a3a2a, 0.3, FY + 0.5, pz); [-0.2, 0.2].forEach((dx) => box(0.06, 0.48, 0.36, pc, 0.3 + dx, FY + 0.24, pz)); }
for (let i = 0; i < 7; i++) { const x = -3.6 + i * 1.2; chair(x, -8.35, 0.6, -11.5, i % 2 ? C.sage : 0xe8b4a6, SEATS.music); }
[[-10.3, -3.9], [10.3, -3.9], [-3.4, -13.1], [3.6, -13.1]].forEach((p) => { cyl(0.32, 0.24, 0.55, 0xe8e2d6, p[0], FY + 0.28, p[1], null, 14); const m = ball(0.6, 0x3f8a52, p[0], FY + 1.15, p[1]); m.scale.y = 1.4; });

// 밥때에만 차려지는 상
const bowls = new THREE.Group(); scene.add(bowls);
const steam = [];
[[5.4, -9.9], [7.7, -5.6]].forEach((t, ti) => {
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.4, x = t[0] + Math.sin(a) * 0.78, z = t[1] + Math.cos(a) * 0.78;
    cyl(0.2, 0.16, 0.035, 0xfafaf5, x, FY + 0.835, z, bowls, 14); cyl(0.1, 0.07, 0.09, 0xe9e4d6, x + 0.2, FY + 0.86, z + 0.12, bowls, 10); }
  for (let k = 0; k < 4; k++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false })); s.userData = { o: k / 4 + ti * 0.13, x: t[0], z: t[1] }; bowls.add(s); steam.push(s); }
});

// 꽃·덤불·책을 한 번에 올립니다
{ const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), blobs.length);
  const d = new THREE.Object3D(), col = new THREE.Color();
  blobs.forEach((b, i) => { d.position.set(b[0], b[1], b[2]); d.scale.setScalar(b[3]); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, col.setHex(b[4])); });
  im.castShadow = true; im.receiveShadow = true; scene.add(im);
  const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 1, 0.2), new THREE.MeshLambertMaterial({ color: 0xffffff }), books.length);
  books.forEach((b, i) => { d.position.set(b[0], b[1] + b[4] / 2, b[2]); d.scale.set(1, b[4], 1); d.updateMatrix(); bm.setMatrixAt(i, d.matrix); bm.setColorAt(i, col.setHex(b[3])); });
  scene.add(bm); }

// 빛, 해, 달, 별
const hemi = new THREE.HemisphereLight(0xe6f1ff, 0x8a7a58, 1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d6, 2.5); sun.castShadow = true;
sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 120 });
scene.add(sun); scene.add(sun.target);
const sunBall = new THREE.Mesh(new THREE.SphereGeometry(8, 20, 16), new THREE.MeshBasicMaterial({ color: 0xffe27a, fog: false })); scene.add(sunBall);
const moonBall = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 16), new THREE.MeshBasicMaterial({ color: 0xf4f1e2, fog: false })); scene.add(moonBall);
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, transparent: true, opacity: 0, fog: false });
{ const sp = []; for (let k = 0; k < 260; k++) { const u = Math.random() * Math.PI * 2, v = Math.random() * 1.2 + 0.15; sp.push(Math.cos(u) * Math.cos(v) * 210, Math.sin(v) * 210, Math.sin(u) * Math.cos(v) * 210 - 20); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); scene.add(new THREE.Points(g, starMat)); }

const clouds = new THREE.Group(); scene.add(clouds);
{ const cm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false });
  for (let i = 0; i < 9; i++) { const g = new THREE.Group(); g.position.set(-160 + i * 42 + rnd() * 20, 46 + rnd() * 26, -150 - rnd() * 40);
    for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(new THREE.SphereGeometry(7 + rnd() * 5, 10, 8), cm); m.position.set(k * 8 - 12, rnd() * 3, rnd() * 4); m.scale.y = 0.5; g.add(m); }
    clouds.add(g); } }
// 비·눈
const NP = small ? 800 : 1400, pPos = new Float32Array(NP * 3);
for (let k = 0; k < NP; k++) { pPos[k * 3] = Math.random() * 50 - 25; pPos[k * 3 + 1] = Math.random() * 20; pPos[k * 3 + 2] = Math.random() * 40 - 20; }
const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
const pMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, transparent: true, opacity: 0.85, depthWrite: false });
const fall = new THREE.Points(pGeo, pMat); fall.visible = false; fall.frustumCulled = false; scene.add(fall);

// ───────── 사람 ─────────
function tag(text, bg, fg = '#fff') {
  const c = document.createElement('canvas'); c.width = 384; c.height = 80;
  const x = c.getContext('2d');
  const draw = () => {
    x.clearRect(0, 0, 384, 80); x.font = '700 34px "Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
    const w = Math.min(372, x.measureText(text).width + 44);
    x.fillStyle = bg; x.beginPath(); if (x.roundRect) x.roundRect(192 - w / 2, 8, w, 64, 32); else x.rect(192 - w / 2, 8, w, 64); x.fill();
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 192, 42, 350);
    t.needsUpdate = true;
  };
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(2.2, 0.46, 1); s.renderOrder = 5; s.userData.draw = draw; draw();
  return s;
}
const people = [];
function person({ name, cloth, pants = 0x6f6a60, hair = 0xdcdcdc, style = 0, bg = 'rgba(38,52,43,.82)', x = 0, z = 0 }) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const legs = [-1, 1].map((sd) => { // 엉덩이에서 앞뒤로 흔들리는 다리
    const lg = new THREE.Group(); lg.position.set(sd * 0.1, 0.56, 0); g.add(lg);
    cyl(0.085, 0.075, 0.5, pants, 0, -0.26, 0, lg, 10); box(0.13, 0.07, 0.25, 0x4a3a30, 0, -0.525, 0.04, lg);
    lg.userData.sd = sd; return lg;
  });
  add(new THREE.CapsuleGeometry(0.215, 0.36, 4, 12), cloth, 0, 0.86, 0, g);
  cyl(0.07, 0.08, 0.08, 0xf2cdaa, 0, 1.17, 0, g, 8);
  [-0.12, 0.12].forEach((cx) => { const c = ball(0.035, 0xf0a99a, cx, 1.32, 0.165, g); c.castShadow = false; });
  ball(0.21, 0xf2cdaa, 0, 1.36, 0, g);
  [-0.075, 0.075].forEach((ex) => { ball(0.025, 0x2a2a2a, ex, 1.38, 0.195, g).castShadow = false; });
  const h = ball(0.222, hair, 0, 1.41, -0.035, g); h.scale.set(1, 0.82, 1);
  if (style === 1) [[-0.15, 1.45, 0], [0.15, 1.45, 0], [0, 1.52, -0.08], [-0.1, 1.42, -0.15], [0.1, 1.42, -0.15]].forEach((p) => ball(0.1, hair, p[0], p[1], p[2], g)); // 파마
  if (style === 2) ball(0.09, hair, 0, 1.42, -0.24, g);                                                           // 쪽머리
  if (style === 3) { cyl(0.23, 0.23, 0.07, 0xb9a98a, 0, 1.5, 0, g, 16); box(0.3, 0.03, 0.16, 0xb9a98a, 0, 1.47, 0.22, g); } // 모자
  const arms = [-1, 1].map((sd) => {
    const ag = new THREE.Group(); ag.position.set(sd * 0.3, 1.06, 0); g.add(ag);
    const geo = new THREE.CylinderGeometry(0.065, 0.06, 0.55, 8); geo.translate(0, -0.27, 0);
    const m = new THREE.Mesh(geo, M(cloth)); m.castShadow = true; ag.add(m); ag.userData.sd = sd; return ag;
  });
  const lb = tag(name, bg); lb.position.y = 1.98; g.add(lb);
  const p = { g, arms, legs, label: lb, target: new THREE.Vector3(x, 0, z), face: null, seated: false, wave: false, bubble: null, bubbleUntil: 0 };
  people.push(p); return p;
}
function removePerson(p) {
  scene.remove(p.g); p.label.material.map.dispose(); p.label.material.dispose();
  const i = people.indexOf(p); if (i >= 0) people.splice(i, 1);
}
function sayHello(p) {
  if (!p.bubble) { p.bubble = tag('안녕하세요!', 'rgba(192,79,53,.95)'); p.bubble.position.y = 2.5; p.g.add(p.bubble); }
  p.bubble.visible = true; p.bubbleUntil = performance.now() + 4000;
}
const STAFF = 'rgba(79,122,90,.95)';
const butler = person({ name: '도우미 · 지배인', cloth: 0xa9bd9a, pants: 0x8fa582, hair: 0x2a2622, style: 2, bg: STAFF, x: 2.2, z: -2.2 });
const chef = person({ name: '도우미 · 영양사', cloth: 0xfafaf5, pants: 0x7f9670, hair: 0x2a2622, style: 2, bg: STAFF, x: 9.3, z: -9 });
const coach = person({ name: '도우미 · 운동 선생님', cloth: 0x8fae7a, pants: 0x4a4f55, hair: 0x2a2622, style: 0, bg: STAFF, x: -6.6, z: 8.6 });
const nurse = person({ name: '보건소 방문 간호사', cloth: 0x9fb8e0, pants: 0x9fb8e0, hair: 0x2a2622, style: 2, bg: 'rgba(63,105,170,.95)', x: 0, z: 16 });
nurse.g.visible = false;
let me = null, myId = Math.floor(Math.random() * 1000);
const others = new Map(); // id -> person
function userPerson(u) {
  const look = Array.isArray(u.look) ? u.look : [0, 0];
  return person({ name: u.leader ? `${u.name} · 건강리더` : u.name, cloth: CLOTHES[look[0] % CLOTHES.length], hair: [0xe8e8e8, 0xcfcfcf, 0xbdbdbd, 0xdedede][look[1] % 4], style: look[1] % 4,
    bg: u.leader ? 'rgba(192,79,53,.92)' : 'rgba(38,52,43,.82)', x: u.x ?? 0, z: u.z ?? 12 });
}
document.fonts?.ready.then(() => { people.forEach((p) => p.label.userData.draw()); signs.forEach((s) => s.userData.draw()); });

// 안내도에 나오는 곳들: [이름, 서 있을 자리 x, z, 팻말 자리 x, z]
const PLACES = [['라운지', -7, -7.9, -7.6, -8.6], ['공방', 2.9, -5.6, 0, -4.7], ['피아노', 0.3, -9.7, 0.6, -12.2], ['식당', 6.5, -7.7, 7.6, -8.2],
  ['텃밭', -9.6, 5, -11, 5], ['꽃길', 3.7, 6, 0, 6], ['쉼터', 8.4, 7.6, 10, 6.6], ['체조 마당', -6.6, 10.6, -6.6, 10.6], ['대문', 0, 14.8, 0, 15.6]];
const signs = PLACES.map((q) => { const s = tag(q[0], 'rgba(255,250,242,.94)', '#26342b'); s.position.set(q[3], floorY0(q[3], q[4]) + 3.3, q[4]); s.scale.set(2.1, 0.44, 1); s.material.depthTest = true; scene.add(s); return s; });
function floorY0(x, z) { return Math.abs(x) <= 11.2 && z <= -2.9 && z >= -14.2 ? FY : 0; }
const inHall = (x, z) => Math.abs(x) <= 11.2 && z <= -2.9 && z >= -14.2;
const floorY = (x, z) => (inHall(x, z) ? FY : 0);
function place(p, x, z, seated, fx, fz, wave) {
  p.target.set(x, 0, z); p.seated = !!seated; p.wave = !!wave;
  p.face = fx === undefined ? null : new THREE.Vector3(fx, 0, fz);
}
const sit = (p, s) => place(p, s.x, s.z, true, s.fx, s.fz);
let nurseIn = false, wanderAt = 0;
function direct(sc, t) {
  if (me && mode === 'stay') {
    const i = myId;
    if (sc === 'meal') sit(me, SEATS.dining[i % 12]);
    else if (sc === 'craft') sit(me, SEATS.craft[i % 8]);
    else if (sc === 'music') sit(me, SEATS.music[i % 7]);
    else if (sc === 'gym') place(me, -9 + (i % 4) * 1.6, 10.6 + (Math.floor(i / 4) % 3) * 1.3, false, -6.6, 8.6, true);
    else if (sc === 'walk') { const a = t * 0.16 + i * 0.5; place(me, Math.sin(a) * 3.7, 6 + Math.cos(a) * 3.7, false); }
    else if (sc === 'greet') { const a = (i % 10) / 10 * Math.PI * 2; place(me, Math.sin(a) * 2.3, 1.1 + Math.cos(a) * 2.3, false, 0, 1.1); }
    else sit(me, SEATS.lounge[i % 6]);
  }
  // 도우미
  if (sc === 'greet') place(butler, 0, 1.1, false, 0, 10);
  else if (sc === 'music') place(butler, 0.3, -11.5, true, 2, -11.5);
  else if (sc === 'craft') place(butler, 2.9, -5.6, false, 0, -5.6);
  else place(butler, 2.2, -2.2, false, 2.2, 10);
  chef.g.visible = sc !== 'night';
  if (sc === 'meal') place(chef, 6.5, -7.7, false, 5.4, -9.9); else place(chef, 9.4, -9.2, false, 0, -9.2);
  coach.g.visible = sc !== 'night';
  if (sc === 'gym') place(coach, -6.6, 8.6, false, -6.6, 20, true);
  else if (sc === 'walk') { const a = t * 0.16 - 0.5; place(coach, Math.sin(a) * 3.7, 6 + Math.cos(a) * 3.7, false); }
  else {
    if (t > wanderAt) { wanderAt = t + 9; const q = [[-6.6, 8.6], [-3.4, 3.2], [3.6, 4], [6, 9], [-8, 12]][Math.floor(Math.random() * 5)]; coach.home = q; }
    const q = coach.home || [-6.6, 8.6]; place(coach, q[0], q[1], false);
  }
  const nv = sc === 'nurse';
  if (nv && !nurseIn) nurse.g.position.set(0, 0, 16);
  nurseIn = nv; nurse.g.visible = nv;
  place(nurse, -5.5, -4.6, false, -6.7, -5.9);
}
const tmp = new THREE.Vector3();
function movePeople(dt, t) {
  const now = performance.now();
  for (const p of people) {
    const g = p.g; tmp.set(p.target.x - g.position.x, 0, p.target.z - g.position.z);
    const d = tmp.length(), moving = d > 0.06;
    if (moving) {
      const step = Math.min(d, (d > 5 ? 4.2 : 1.6) * dt); tmp.multiplyScalar(step / d);
      g.position.x += tmp.x; g.position.z += tmp.z;
      g.rotation.y = Math.atan2(tmp.x, tmp.z);
    } else if (p.face) g.rotation.y = Math.atan2(p.face.x - g.position.x, p.face.z - g.position.z);
    else if (p.netR !== undefined) g.rotation.y = p.netR;
    const seated = !moving && p.seated;
    const fy = floorY(g.position.x, g.position.z) + (moving ? Math.abs(Math.cos(t * 9)) * 0.04 : 0) + (seated ? 0.08 : 0);
    g.position.y += (fy - g.position.y) * Math.min(1, dt * 10);
    g.scale.y += ((seated ? 0.8 : 1) - g.scale.y) * Math.min(1, dt * 6);
    const near = Math.max(0.42, Math.min(1, cam.position.distanceTo(g.position) / 8)); // 가까이서는 이름표를 작게
    p.label.scale.set(2.2 * near, 0.46 * near / g.scale.y, 1);
    for (const ag of p.arms) {
      const want = (!moving && p.wave) ? ag.userData.sd * (1.5 + Math.sin(t * 2.2) * 1.3) : 0;
      ag.rotation.z += (want - ag.rotation.z) * Math.min(1, dt * 6);
      ag.rotation.x = moving ? Math.sin(t * 9) * 0.5 * ag.userData.sd : seated ? -0.9 : 0;
    }
    for (const lg of p.legs) { // 걸을 때는 팔과 엇갈려 앞뒤로, 앉으면 앞으로 뻗습니다
      const want = moving ? -Math.sin(t * 9) * 0.6 * lg.userData.sd : seated ? -1.35 : 0;
      lg.rotation.x += (want - lg.rotation.x) * Math.min(1, dt * 14);
    }
    if (p.bubble?.visible && now > p.bubbleUntil) p.bubble.visible = false;
  }
}

// ───────── 하늘과 빛: 실제 시각을 따라 ─────────
const KEYS = [[0, 0x0b1730], [300, 0x0b1730], [390, 0xf2a48c], [480, 0x9ccdf0], [990, 0x9ccdf0], [1080, 0xf5a873], [1170, 0x0b1730], [1440, 0x0b1730]];
const cA = new THREE.Color(), cB = new THREE.Color(), sky = new THREE.Color();
function paintSky(min) {
  for (let i = 0; i < KEYS.length - 1; i++) if (min >= KEYS[i][0] && min <= KEYS[i + 1][0]) { cA.setHex(KEYS[i][1]); cB.setHex(KEYS[i + 1][1]); sky.copy(cA).lerp(cB, (min - KEYS[i][0]) / (KEYS[i + 1][0] - KEYS[i][0])); break; }
  const w = wxKind(), a = (min - 360) / 720 * Math.PI, up = Math.sin(a), dayf = Math.max(0, Math.min(1, up * 3 + 0.15));
  if (w !== 'clear') sky.lerp(cA.setHex(w === 'snow' ? 0xc3cbd1 : w === 'rain' ? 0x7f8a93 : 0xaab4bc), 0.75 * dayf + 0.15);
  scene.background.copy(sky); scene.fog.color.copy(sky);
  scene.fog.near = w === 'clear' ? 60 : 25; scene.fog.far = w === 'clear' ? 240 : 130;
  const dim = w === 'clear' ? 1 : 0.35;
  if (up > 0) { sun.position.set(Math.cos(a) * 40, Math.max(5, up * 40), 16); sun.color.setHex(up < 0.25 ? 0xffc48a : 0xfff2d6); sun.intensity = (0.5 + 2.2 * Math.min(1, up * 2.5)) * dim; }
  else { sun.position.set(-Math.cos(a) * 40, Math.max(8, -up * 40), 16); sun.color.setHex(0x9db4e8); sun.intensity = 0.45 * dim; }
  hemi.intensity = 0.45 + 0.75 * dayf * (w === 'clear' ? 1 : 0.85);
  sunBall.position.set(Math.cos(a) * 200, up * 170 - 6, -190); sunBall.visible = w === 'clear' && up > -0.08;
  moonBall.position.set(-Math.cos(a) * 200, -up * 170 - 6, -190); moonBall.visible = w === 'clear' && up < 0.08;
  starMat.opacity = w === 'clear' ? (1 - dayf) * 0.9 : 0;
  clouds.visible = dayf > 0.4; clouds.position.x = (min % 720) / 720 * 40 - 20;
  const lit = (min >= 1020 || min < 420) ? ((min >= 1290 || min < 330) ? 0.3 : 1) : (1 - dayf);
  lamps.forEach((l) => { l.intensity = lit * 26; });
  shadeMat.emissiveIntensity = 0.15 + lit * 1.2; wallMat.emissiveIntensity = lit * 0.5; lampMat.emissiveIntensity = lit * 1.6;
  groundMat.color.copy(groundBase); pathMat.color.setHex(C.stone);
  if (w === 'snow') { groundMat.color.lerp(white, 0.8); pathMat.color.lerp(white, 0.7); } else if (w === 'rain') pathMat.color.setHex(0xb9ae9c);
  hHand.rotation.z = -((min / 60) % 12) / 12 * Math.PI * 2; mHand.rotation.z = -(min % 60) / 60 * Math.PI * 2;
}
function paintFall(dt, t) {
  const w = wxKind();
  fall.visible = w === 'rain' || w === 'snow'; if (!fall.visible) return;
  const sp = w === 'rain' ? 24 : 2.4;
  pMat.size = w === 'rain' ? 0.08 : 0.17; pMat.color.setHex(w === 'rain' ? 0xc5d6e6 : 0xffffff);
  for (let i = 0; i < NP; i++) {
    pPos[i * 3 + 1] -= sp * dt * (0.7 + (i % 7) / 10);
    if (w === 'snow') pPos[i * 3] += Math.sin(t + i) * dt * 0.6;
    if (pPos[i * 3 + 1] < 0) pPos[i * 3 + 1] = 20;
  }
  pGeo.attributes.position.needsUpdate = true;
}

// ───────── 카메라와 누르기 ─────────
const look = new THREE.Vector3(0, 1.4, -4), camWant = new THREE.Vector3(), lookWant = new THREE.Vector3();
cam.position.set(0, 9, 30);
const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const view = { yaw: 0, pitch: 0.27, dist: 7.5 };
function zoomBy(f) { view.dist = Math.max(2.6, Math.min(26, view.dist * f)); }
function moveCam(dt, t) {
  let yaw = view.yaw, pitch = view.pitch, dist = view.dist;
  if (!entered || !me) { lookWant.set(0, 1.6, -4); yaw = still ? 0 : Math.sin(t * 0.08) * 0.35; pitch = 0.2; dist = 23; }
  else {
    const q = me.g.position; lookWant.set(q.x, q.y + 1.25, q.z);
    if (mode === 'stay' && !still && !pointers.size) yaw += Math.sin(t * 0.09) * 0.12;
  }
  const cp = Math.cos(pitch);
  camWant.set(lookWant.x + Math.sin(yaw) * cp * dist, lookWant.y + Math.sin(pitch) * dist, lookWant.z + Math.cos(yaw) * cp * dist);
  if (inHall(lookWant.x, lookWant.z)) { // 벽과 유리창 밖으로 나가지 않게
    camWant.x = Math.max(-10.7, Math.min(10.7, camWant.x)); camWant.z = Math.max(-13.6, camWant.z);
  }
  camWant.y = Math.max(floorY(camWant.x, camWant.z) + 0.7, camWant.y);
  const kf = Math.min(1, dt * 3);
  cam.position.lerp(camWant, kf); look.lerp(lookWant, kf); cam.lookAt(look);
  roofG.visible = cam.position.y < FY + WH + 0.1;
}
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
const marker = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
marker.rotation.x = -Math.PI / 2; marker.visible = false; marker.renderOrder = 4; scene.add(marker);
const pointers = new Map();
let moved = 0, pinch = 0;
const pinchGap = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
cv.addEventListener('pointerdown', (e) => {
  try { cv.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 됩니다 */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) moved = 0; else if (pointers.size === 2) { pinch = pinchGap(); moved = 99; }
});
cv.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 1) { // 한 손가락으로 끌면 둘러봅니다
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 10) { view.yaw -= dx * 0.006; view.pitch = Math.max(0.06, Math.min(1.35, view.pitch + dy * 0.005)); }
  } else if (pointers.size === 2) { const g = pinchGap(); if (pinch > 0 && g > 0) zoomBy(pinch / g); pinch = g; } // 두 손가락으로 벌리면 확대
});
function tapWalk(e) {
  if (mode !== 'walk' || !me) return;
  const r = cv.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1)), cam);
  if (!ray.ray.intersectPlane(plane, hit)) return;
  if (hit.distanceTo(me.g.position) > 30) hit.sub(me.g.position).setLength(30).add(me.g.position);
  hit.x = Math.max(-15.5, Math.min(15.5, hit.x)); hit.z = Math.max(-13.4, Math.min(16.4, hit.z));
  if (hit.z < -2.9 && hit.z > -3.4 && Math.abs(hit.x) > 11) hit.z = -2.6;
  place(me, hit.x, hit.z, false);
  marker.position.set(hit.x, floorY(hit.x, hit.z) + 0.06, hit.z); marker.visible = true;
}
const lift = (e) => { const had = pointers.delete(e.pointerId); if (had && e.type === 'pointerup' && !pointers.size && moved <= 10) tapWalk(e); if (pointers.size < 2) pinch = 0; };
cv.addEventListener('pointerup', lift); cv.addEventListener('pointercancel', lift);
cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(e.deltaY > 0 ? 1.12 : 0.89); }, { passive: false });

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h || !renderer) return;
  renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
}
if (window.ResizeObserver) new ResizeObserver(resize).observe(stage); else window.addEventListener('resize', resize);
resize();

// ───────── 함께 있는 사람들 (WebSocket) ─────────
let ws = null, sentKey = '', retry = 0;
const send = (obj) => { if (ws?.readyState === 1) ws.send(JSON.stringify(obj)); };
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => { retry = 0; sentKey = ''; send({ t: 'join', name: store.name, region: store.regionName, leader: !!store.leader, look: store.look, cid: store.cid }); };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'hi') {
      myId = m.id; for (const p of others.values()) removePerson(p); others.clear();
      for (const u of m.players) others.set(u.id, Object.assign(userPerson(u), { netR: u.r }));
      together(m.total);
    } else if (m.t === 'in') { if (!others.has(m.id)) others.set(m.id, Object.assign(userPerson(m), { netR: m.r })); }
    else if (m.t === 'out') { const p = others.get(m.id); if (p) { removePerson(p); others.delete(m.id); } }
    else if (m.t === 's') for (const [id, x, z, r, a] of m.ps) { const p = others.get(id); if (p) { p.target.set(x, 0, z); p.netR = r; p.seated = a === 1; p.wave = a === 2; } }
    else if (m.t === 'hello') { const p = others.get(m.id); if (p) sayHello(p); }
    else if (m.t === 'n') together(m.total);
  };
  ws.onclose = () => { ws = null; setTimeout(connect, Math.min(15000, 1500 * 2 ** retry++)); };
}
function together(n) { $('town-name').textContent = n > 1 ? `${store.townName || '온라인 실버타운'} · 지금 ${n}분이 함께 있어요` : (store.townName || '온라인 실버타운'); }
setInterval(() => { // 내 자리를 0.2초마다, 바뀌었을 때만 알립니다
  if (!me || ws?.readyState !== 1) return;
  const q = me.g.position, moving = Math.hypot(me.target.x - q.x, me.target.z - q.z) > 0.06;
  const a = moving ? 0 : me.seated ? 1 : me.wave ? 2 : 0;
  const msg = { t: 'p', x: Math.round(me.target.x * 100) / 100, z: Math.round(me.target.z * 100) / 100, r: Math.round(me.g.rotation.y * 100) / 100, a };
  const key = `${msg.x},${msg.z},${a},${moving ? '' : msg.r}`;
  if (key !== sentKey) { sentKey = key; send(msg); }
}, 200);

// ───────── 내 동네 날씨 ─────────
async function loadWeather() {
  if (store.lat === undefined) return;
  try { const r = await fetch(`/api/weather?lat=${store.lat}&lon=${store.lon}`); const j = await r.json(); realWx = j.weather || null; } catch { /* 못 받으면 맑음으로 둡니다 */ }
  paintCaption(true);
}
setInterval(loadWeather, 10 * 60e3);

// ───────── 돌아가는 장면 ─────────
const clockT = new THREE.Clock();
let T = 0;
function frame() {
  const dt = Math.min(0.05, clockT.getDelta()); T += dt;
  const min = nowMin(), s = slot(min);
  paintCaption(false);
  paintSky(min);
  direct(s.scene, T);
  movePeople(dt, T);
  const meal = s.scene === 'meal'; bowls.visible = meal;
  if (meal) for (const m of steam) { const f = (T * 0.25 + m.userData.o) % 1; m.position.set(m.userData.x + Math.sin(m.userData.o * 20) * 0.5, FY + 1 + f * 1.2, m.userData.z + Math.cos(m.userData.o * 20) * 0.5); m.material.opacity = 0.3 * (1 - f); m.scale.setScalar(0.7 + f); }
  if (marker.visible && me && Math.hypot(me.g.position.x - marker.position.x, me.g.position.z - marker.position.z) < 0.5) marker.visible = false;
  paintFall(dt, T);
  moveCam(dt, T);
  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}
setInterval(() => { const n = kst(); if (n.key !== today.key) { today = n; drawCal(); paintCaption(true); } }, 30000);

// ───────── 들어가는 문과 단추 ─────────
function setMode(m) {
  mode = m;
  $('m-stay').setAttribute('aria-pressed', m === 'stay'); $('m-walk').setAttribute('aria-pressed', m === 'walk');
  $('hint').textContent = '가고 싶은 곳을 누르세요'; $('hint').hidden = m !== 'walk';
  marker.visible = false;
  if (m === 'walk' && me) place(me, me.g.position.x, me.g.position.z, false);
  if (m === 'stay') try { navigator.wakeLock?.request('screen').catch(() => {}); } catch { /* 화면 켜 두기를 못 하는 기기 */ }
}
function toast(text, ms = 7000) { const h = $('hint'); h.textContent = text; h.hidden = false; setTimeout(() => { if (h.textContent === text) setMode(mode); }, ms); }
function nearestRegion(lat, lon) { let b = 0, bd = 1e9; REGIONS.forEach((r, i) => { const d = (r[1] - lat) ** 2 + ((r[2] - lon) * 0.8) ** 2; if (d < bd) { bd = d; b = i; } }); return b; }

const sel = $('in-region');
REGIONS.forEach((r, i) => { const o = document.createElement('option'); o.value = i; o.textContent = r[0]; sel.append(o); });
$('in-name').value = store.name || '';
sel.value = Number.isInteger(store.region) ? store.region : 0;
$('in-leader').checked = !!store.leader;
let geo = store.geo ? { lat: store.lat, lon: store.lon } : null;
if (geo) $('geo-msg').textContent = '지금 있는 곳의 날씨로 맞춰져 있어요.';
sel.addEventListener('change', () => { geo = null; $('geo-msg').textContent = ''; });
$('geo').addEventListener('click', () => {
  if (!navigator.geolocation) { $('geo-msg').textContent = '이 기기에서는 위치를 알 수 없어요. 위에서 사는 곳을 골라 주세요.'; return; }
  $('geo-msg').textContent = '위치를 찾고 있어요…';
  navigator.geolocation.getCurrentPosition((pos) => {
    geo = { lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 };
    sel.value = nearestRegion(geo.lat, geo.lon);
    $('geo-msg').textContent = `${REGIONS[sel.value][0]} 근처로 맞췄어요.`;
  }, () => { $('geo-msg').textContent = '위치를 알 수 없었어요. 위에서 사는 곳을 골라 주세요.'; }, { timeout: 10000, maximumAge: 600000 });
});

$('gate').addEventListener('submit', (e) => {
  e.preventDefault();
  const idx = Number(sel.value) || 0;
  store.name = $('in-name').value.trim().slice(0, 12) || '입주민';
  store.region = idx; store.regionName = REGIONS[idx][0];
  store.geo = !!geo; store.lat = geo ? geo.lat : REGIONS[idx][1]; store.lon = geo ? geo.lon : REGIONS[idx][2];
  store.leader = $('in-leader').checked;
  const first = !store.stamps.includes(today.key);
  if (first) store.stamps = [...store.stamps, today.key].slice(-60);
  save();
  $('gate').hidden = true; $('top').hidden = false; $('bottom').hidden = false; $('zoom').hidden = false;
  entered = true;
  if (renderer) {
    me = userPerson({ name: store.name, leader: store.leader, look: store.look, x: 0, z: 14 });
    me.label.material.map.dispose(); me.g.remove(me.label);
    me.label = tag(`${store.name} (나)`, 'rgba(192,79,53,.95)'); me.label.position.y = 1.98; me.g.add(me.label);
    connect();
  }
  loadWeather();
  setMode('stay');
  const week = (() => { const d = new Date(Date.UTC(today.year, today.month - 1, today.day)); const mon = d.getTime() - ((today.dow + 6) % 7) * 864e5; let n = 0; for (let i = 0; i < 7; i++) { const x = new Date(mon + i * 864e5); if (store.stamps.includes(`${x.getUTCFullYear()}-${x.getUTCMonth() + 1}-${x.getUTCDate()}`)) n++; } return n; })();
  toast(first ? `출석 도장 쾅! 이번 주 ${week}번째예요` : `${store.name} 님, 다시 오셨네요`);
  paintCaption(true);
  announce(`${store.name} 님, 어서 오세요. ${fullStatus()}`);
});
// 안내도
const mapEl = $('map'), mapBox = $('map-box');
const mx = (x) => `${(x + 17) / 34 * 100}%`, mz = (z) => `${(z + 15) / 33 * 100}%`;
PLACES.forEach((q, i) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'spot'; b.id = `spot-${i}`; b.textContent = q[0];
  b.style.left = mx(q[3]); b.style.top = mz(q[4]);
  b.addEventListener('click', () => goTo(q));
  mapBox.append(b);
});
function paintMe() { if (me) { $('map-me').style.left = mx(me.g.position.x); $('map-me').style.top = mz(me.g.position.z); } }
function goTo(q) {
  mapEl.hidden = true;
  if (!me) return;
  setMode('walk');
  place(me, q[1], q[2], false);
  marker.position.set(q[1], floorY(q[1], q[2]) + 0.06, q[2]); marker.visible = true;
  const last = (q[0].charCodeAt(q[0].length - 1) - 0xAC00) % 28;
  const text = `${q[0]}${last === 0 || last === 8 ? '로' : '으로'} 가고 있어요`;
  toast(text, 6000); if (soundOn) speak(text);
}
$('map-btn').addEventListener('click', () => { paintMe(); mapEl.hidden = false; });
$('map-close').addEventListener('click', () => { mapEl.hidden = true; });
setInterval(() => { if (!mapEl.hidden) paintMe(); }, 500);
$('zoom-in').addEventListener('click', () => zoomBy(0.72));
$('zoom-out').addEventListener('click', () => zoomBy(1.4));
$('caption').addEventListener('click', () => { hideCaption(); try { speechSynthesis.cancel(); } catch { /* 없음 */ } });
$('clock-chip').addEventListener('click', () => { paintCaption(true); announce(fullStatus(), false); });
$('m-stay').addEventListener('click', () => setMode('stay'));
$('m-walk').addEventListener('click', () => setMode('walk'));
$('hello').addEventListener('click', () => { if (me) { sayHello(me); send({ t: 'hello' }); } });
$('sound').addEventListener('click', function () {
  soundOn = !soundOn;
  this.setAttribute('aria-pressed', soundOn);
  this.textContent = soundOn ? '🔊' : '🔇'; this.setAttribute('aria-label', soundOn ? '소리 끄기' : '소리 켜기');
  if (soundOn) announce(fullStatus()); else try { speechSynthesis.cancel(); } catch { /* 없음 */ }
});
if (DEMO) {
  $('demo').hidden = false;
  $('sim').addEventListener('input', function () { simMin = +this.value; $('sim-label').textContent = `시간 돌려 보기: ${clockText(simMin)}`; paintCaption(true); });
  $('sim-now').addEventListener('click', () => { simMin = null; $('sim-label').textContent = '시간 돌려 보기'; paintCaption(true); });
  ['real', 'clear', 'rain', 'snow'].forEach((w) => $(`w-${w}`).addEventListener('click', () => {
    demoWx = w === 'real' ? null : w; ['real', 'clear', 'rain', 'snow'].forEach((x) => $(`w-${x}`).setAttribute('aria-pressed', x === w)); paintCaption(true);
  }));
}

// ───────── 시작 ─────────
fetch('/api/state').then((r) => r.json()).then((j) => {
  clockSkew = j.now - Date.now(); today = kst();
  store.townName = j.name; $('town-name').textContent = j.name; $('gate-name').textContent = j.name; $('gate-sub').textContent = j.subtitle; document.title = j.name;
  PLAN = (j.schedule || []).map((p) => { const [h, m] = p.time.split(':').map(Number); return { ...p, s: h * 60 + m, e: h * 60 + m + p.minutes }; }).sort((a, b) => a.s - b.s);
  drawCal(); paintCaption(true);
}).catch(() => paintCaption(true));
if (renderer) frame();
else { $('fail').hidden = false; cv.hidden = true; setInterval(() => paintCaption(false), 5000); }
