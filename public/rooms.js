// 온라인 실버타운 — 그림으로 보는 화면. 방마다 그림 한 장 위에 실제 시각의 빛과 날씨를 얹습니다.
const $ = (id) => document.getElementById(id);
const DOW = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const REGIONS = [['서울', 37.57, 126.98], ['부산', 35.18, 129.08], ['대구', 35.87, 128.6], ['인천', 37.46, 126.71], ['광주', 35.16, 126.85],
  ['대전', 36.35, 127.38], ['울산', 35.54, 129.31], ['세종', 36.48, 127.29], ['경기', 37.27, 127.01], ['강원', 37.88, 127.73], ['충북', 36.64, 127.49],
  ['충남', 36.6, 126.66], ['전북', 35.82, 127.15], ['전남', 34.82, 126.46], ['경북', 36.57, 128.73], ['경남', 35.23, 128.68], ['제주', 33.5, 126.53]];
// 방: [파일, 이름, 바깥인지]
const ROOMS = [['lobby', '로비'], ['lounge', '라운지'], ['cafe', '북카페'], ['dining', '식당'], ['gym', '체조실'], ['craft', '공방'], ['music', '음악실'],
  ['nurse', '건강 상담실'], ['health', '건강 측정실'], ['pool', '수영장'], ['garden', '정원', true], ['terrace', '테라스', true], ['room', '내 방']];
const SCENE_ROOM = { greet: 'lobby', meal: 'dining', tea: 'cafe', gym: 'gym', craft: 'craft', music: 'music', nurse: 'nurse', walk: 'garden', free: 'lounge', night: 'room' };
const DEMO = new URLSearchParams(location.search).has('demo');

let store = {};
try { store = JSON.parse(localStorage.getItem('town') || '{}') || {}; } catch { store = {}; }
const save = () => { try { localStorage.setItem('town', JSON.stringify(store)); } catch { /* 저장이 막혀 있어도 그대로 씁니다 */ } };
if (!store.cid) store.cid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
if (!Array.isArray(store.stamps)) store.stamps = [];

let clockSkew = 0;
function kst() {
  const d = new Date(Date.now() + clockSkew + 9 * 3600e3);
  const o = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), dow: d.getUTCDay() };
  o.min = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  o.key = `${o.year}-${o.month}-${o.day}`;
  return o;
}
function clockText(min) {
  const h = Math.floor(min / 60) % 24, m = Math.floor(min % 60);
  return `${h === 0 ? '밤' : h < 12 ? '오전' : h === 12 ? '낮' : '오후'} ${h % 12 || 12}시${m ? ` ${m}분` : ''}`;
}
function after(mins) { mins = Math.max(1, Math.round(mins)); const h = Math.floor(mins / 60), m = mins % 60; return `${h ? `${h}시간 ` : ''}${m ? `${m}분 ` : ''}뒤`; }
const josa = (w, a, b) => { const k = (w.charCodeAt(w.length - 1) - 0xAC00) % 28; return k === 0 || (a === '로' && k === 8) ? a : b; };

let PLAN = [], simMin = null, demoWx = null, realWx = null, soundOn = true, entered = false, today = kst();
let manual = null;   // 안내도에서 직접 고른 방 (없으면 시간표를 따라갑니다)
let curRoom = '';
const nowMin = () => (simMin === null ? kst().min : simMin);
function slot(min) {
  let cur = null, nxt = null;
  for (const p of PLAN) { if (min >= p.s && min < p.e) cur = p; else if (!nxt && p.s > min) nxt = p; }
  return { cur, nxt, scene: cur ? cur.scene : (min >= 1260 || min < 360) ? 'night' : 'free' };
}
function wxKind() {
  const k = demoWx || realWx?.kind || 'clear';
  return k === 'rain' || k === 'storm' ? 'rain' : k === 'snow' ? 'snow' : k === 'cloudy' || k === 'fog' ? 'cloud' : 'clear';
}

// ───────── 소리와 글씨 칸 ─────────
let actx = null, capTimer = 0, lastTitle = null, lastMinKey = -1, lastSay = '';
function chime() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    [660, 880].forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.35;
      o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 1.3);
    });
  } catch { /* 소리를 못 내는 기기 */ }
}
function speak(text, onEnd) {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.rate = 0.85; if (onEnd) u.onend = onEnd;
    speechSynthesis.speak(u);
  } catch { /* 말소리를 못 내는 기기 */ }
}
function hideCaption() { clearTimeout(capTimer); $('caption').hidden = true; }
function announce(text, chimeFirst = true) {
  clearTimeout(capTimer); $('caption').hidden = false;
  capTimer = setTimeout(hideCaption, soundOn ? 40000 : 12000);
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
  const r = store.regionName || '우리 동네';
  return `지금 ${r}${josa(r, '는', '은')} ${word}. ${t}도예요. ${tip}`.trim();
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
  $('say').textContent = lastSay; $('wx').textContent = wxText();
  $('caption').classList.toggle('meal', !!(s.cur && s.cur.meal));
  $('clock-chip').textContent = `🕘 ${clockText(min)}`;
  if (entered && lastTitle !== null && title !== lastTitle) { manual = null; $('follow').hidden = true; announce(`${title}. ${lastSay}`); } // 일정이 바뀌면 모두 함께 그 방으로
  lastTitle = title;
  showRoom(manual || SCENE_ROOM[s.scene] || 'lounge');
  paintLight();
}
const fullStatus = () => `오늘은 ${today.month}월 ${today.day}일 ${DOW[today.dow]}입니다. 지금은 ${clockText(nowMin())}입니다. ${$('now').textContent}. ${$('next').textContent} ${wxText()}`;

// ───────── 그림: 바꾸기, 둘러보기, 확대 ─────────
const view = $('view'), pics = [$('pic-a'), $('pic-b')];
let front = 0, pan = 0.5, panDir = 1, zoom = 1, vy = 0.5, lastTouch = 0;
const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function showRoom(key) {
  if (key === curRoom) return;
  curRoom = key;
  const r = ROOMS.find((x) => x[0] === key);
  $('place').textContent = r[1];
  const next = pics[1 - front];
  next.onload = () => { pics[front].classList.remove('on'); next.classList.add('on'); front = 1 - front; pan = 0.5; zoom = 1; layout(); };
  next.src = `/rooms/${key}.jpg`;
  document.querySelectorAll('#thumbs button').forEach((b) => b.setAttribute('aria-current', b.dataset.k === key));
}
function layout() {
  const W = view.clientWidth, H = view.clientHeight;
  for (const im of pics) {
    if (!im.naturalWidth) continue;
    const base = Math.max(W / im.naturalWidth, H / im.naturalHeight) * zoom; // 화면을 빈틈없이 채우는 크기에서 시작
    const w = im.naturalWidth * base, h = im.naturalHeight * base;
    im.style.height = `${h}px`;
    im.style.transform = `translate(${-(w - W) * pan}px, ${-(h - H) * vy}px)`;
  }
}
function tick() {
  if (!still && Date.now() - lastTouch > 6000) { // 손대지 않으면 천천히 좌우로 둘러봅니다
    pan += panDir * 0.00035; if (pan > 1) { pan = 1; panDir = -1; } if (pan < 0) { pan = 0; panDir = 1; }
    layout();
  }
  drawFx();
  requestAnimationFrame(tick);
}
const pointers = new Map(); let pinch = 0;
const gap = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
function zoomBy(f) { zoom = Math.max(1, Math.min(3, zoom * f)); lastTouch = Date.now(); layout(); }
view.addEventListener('pointerdown', (e) => { try { view.setPointerCapture(e.pointerId); } catch { /* 없음 */ } pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.size === 2) pinch = gap(); });
view.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; lastTouch = Date.now();
  const im = pics[front], W = view.clientWidth, H = view.clientHeight;
  if (pointers.size === 1 && im.naturalWidth) {
    const w = im.getBoundingClientRect().width, h = im.getBoundingClientRect().height;
    if (w > W + 1) pan = Math.max(0, Math.min(1, pan - dx / (w - W)));
    if (h > H + 1) vy = Math.max(0, Math.min(1, vy - dy / (h - H)));
    layout();
  } else if (pointers.size === 2) { const g = gap(); if (pinch > 0 && g > 0) zoomBy(g / pinch); pinch = g; }
});
const lift = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; };
view.addEventListener('pointerup', lift); view.addEventListener('pointercancel', lift);
view.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(e.deltaY > 0 ? 0.9 : 1.11); }, { passive: false });
window.addEventListener('resize', () => { layout(); sizeFx(); });

// ───────── 실제 시각의 빛, 내 동네 날씨 ─────────
function paintLight() {
  const min = nowMin(), w = wxKind();
  const up = Math.sin((min - 360) / 720 * Math.PI);          // 해의 높이 (-1 ~ 1)
  const night = Math.max(0, Math.min(1, (0.12 - up) / 0.3));  // 0 낮 … 1 밤
  const dusk = Math.max(0, 1 - Math.abs(up - 0.08) / 0.22);   // 해 뜰 녘 · 해 질 녘
  const outside = !!ROOMS.find((x) => x[0] === curRoom)?.[2];
  let r = 255, g = 255, b = 255;
  const mix = (cr, cg, cb, k) => { r += (cr - r) * k; g += (cg - g) * k; b += (cb - b) * k; };
  mix(255, 190, 140, dusk * 0.45);
  mix(outside ? 38 : 70, outside ? 52 : 72, outside ? 110 : 120, night * (outside ? 0.85 : 0.7));
  if (w !== 'clear') mix(170, 178, 190, (1 - night) * (w === 'cloud' ? 0.3 : 0.45));
  $('tint').style.backgroundColor = `rgb(${r | 0},${g | 0},${b | 0})`;
  $('glow').style.opacity = outside ? night * 0.25 : night * 0.9;
  fx.style.opacity = outside ? 1 : 0.3; // 실내에서는 창밖 기척 정도로만 // 밤에는 실내등이 켜진 듯 따뜻하게
}
const fx = $('fx'), fc = fx.getContext('2d'); let drops = [];
function sizeFx() { fx.width = view.clientWidth; fx.height = view.clientHeight; drops = Array.from({ length: 140 }, () => [Math.random() * fx.width, Math.random() * fx.height, 0.6 + Math.random() * 0.8]); }
function drawFx() {
  const w = wxKind(); fc.clearRect(0, 0, fx.width, fx.height);
  if (w !== 'rain' && w !== 'snow') return;
  fc.strokeStyle = 'rgba(225,236,248,.55)'; fc.fillStyle = 'rgba(255,255,255,.85)'; fc.lineWidth = 1.2;
  for (const d of drops) {
    if (w === 'rain') { d[1] += 13 * d[2]; d[0] -= 2; fc.beginPath(); fc.moveTo(d[0], d[1]); fc.lineTo(d[0] - 3, d[1] + 15 * d[2]); fc.stroke(); }
    else { d[1] += 1.1 * d[2]; d[0] += Math.sin(d[1] / 30) * 0.5; fc.beginPath(); fc.arc(d[0], d[1], 2.2 * d[2], 0, 6.3); fc.fill(); }
    if (d[1] > fx.height) { d[1] = -20; d[0] = Math.random() * fx.width; }
  }
}
async function loadWeather() {
  if (store.lat === undefined) return;
  try { const j = await (await fetch(`/api/weather?lat=${store.lat}&lon=${store.lon}`)).json(); realWx = j.weather || null; } catch { /* 못 받으면 맑음 */ }
  paintCaption(true);
}
setInterval(loadWeather, 10 * 60e3);

// ───────── 함께 있는 사람 수 ─────────
let ws = null, retry = 0;
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: 'join', name: store.name, region: store.regionName, cid: store.cid })); };
  ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.t === 'hi' || m.t === 'n') together(m.total); };
  ws.onclose = () => { ws = null; setTimeout(connect, Math.min(15000, 1500 * 2 ** retry++)); };
}
function together(n) { $('town-name').textContent = n > 1 ? `지금 ${n}분이 함께 있어요` : (store.townName || '온라인 실버타운'); }

// ───────── 안내도 ─────────
ROOMS.forEach((r) => {
  const b = document.createElement('button'); b.type = 'button'; b.dataset.k = r[0]; b.id = `go-${r[0]}`;
  const im = document.createElement('img'); im.src = `/rooms/${r[0]}-s.jpg`; im.alt = ''; im.loading = 'lazy';
  const sp = document.createElement('span'); sp.textContent = r[1];
  b.append(im, sp);
  b.addEventListener('click', () => {
    $('map').hidden = true; manual = r[0]; $('follow').hidden = false; showRoom(r[0]); paintLight();
    if (soundOn) speak(`${r[1]}${josa(r[1], '로', '으로')} 왔어요`);
  });
  $('thumbs').append(b);
});
$('map-btn').addEventListener('click', () => { $('map').hidden = false; });
$('map-close').addEventListener('click', () => { $('map').hidden = true; });
$('follow').addEventListener('click', () => { manual = null; $('follow').hidden = true; paintCaption(true); });
$('zoom-in').addEventListener('click', () => zoomBy(1.3));
$('zoom-out').addEventListener('click', () => zoomBy(0.77));
$('caption').addEventListener('click', () => { hideCaption(); try { speechSynthesis.cancel(); } catch { /* 없음 */ } });
$('clock-chip').addEventListener('click', () => { paintCaption(true); announce(fullStatus(), false); });
$('sound').addEventListener('click', function () {
  soundOn = !soundOn; this.setAttribute('aria-pressed', soundOn); this.textContent = soundOn ? '🔊' : '🔇'; this.setAttribute('aria-label', soundOn ? '소리 끄기' : '소리 켜기');
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

// ───────── 들어가는 문 ─────────
const sel = $('in-region');
REGIONS.forEach((r, i) => { const o = document.createElement('option'); o.value = i; o.textContent = r[0]; sel.append(o); });
$('in-name').value = store.name || ''; sel.value = Number.isInteger(store.region) ? store.region : 0;
$('gate').addEventListener('submit', (e) => {
  e.preventDefault();
  const idx = Number(sel.value) || 0;
  store.name = $('in-name').value.trim().slice(0, 12) || '입주민';
  if (store.region !== idx || store.lat === undefined) { store.geo = false; store.lat = REGIONS[idx][1]; store.lon = REGIONS[idx][2]; }
  store.region = idx; store.regionName = REGIONS[idx][0];
  if (!store.stamps.includes(today.key)) store.stamps = [...store.stamps, today.key].slice(-60);
  save();
  $('gate').hidden = true; $('top').hidden = false; $('bottom').hidden = false; $('zoom').hidden = false;
  entered = true; lastTouch = 0;
  try { navigator.wakeLock?.request('screen').catch(() => {}); } catch { /* 화면 켜 두기를 못 하는 기기 */ }
  connect(); loadWeather(); paintCaption(true);
  announce(`${store.name} 님, 어서 오세요. ${fullStatus()}`);
});

fetch('/api/state').then((r) => r.json()).then((j) => {
  clockSkew = j.now - Date.now(); today = kst();
  store.townName = j.name; $('town-name').textContent = j.name; $('gate-name').textContent = j.name; $('gate-sub').textContent = j.subtitle; document.title = j.name;
  PLAN = (j.schedule || []).map((p) => { const [h, m] = p.time.split(':').map(Number); return { ...p, s: h * 60 + m, e: h * 60 + m + p.minutes }; }).sort((a, b) => a.s - b.s);
  paintCaption(true);
}).catch(() => paintCaption(true));
setInterval(() => { const n = kst(); if (n.key !== today.key) today = n; paintCaption(false); }, 5000);
sizeFx(); tick();
