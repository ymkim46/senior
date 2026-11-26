// 온라인 실버타운 서버 — Node 22+ 내장 모듈과 ws만 씁니다.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const loadConfig = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

// ---------- DB (방문 수만 셉니다) ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'town.db'));
db.exec(`PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS counters (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind));`);
const q = {
  bump: db.prepare('INSERT INTO counters (day, kind, n) VALUES (?, ?, 1) ON CONFLICT(day, kind) DO UPDATE SET n = n + 1'),
  visits: db.prepare("SELECT COALESCE(SUM(n), 0) AS total, COALESCE(SUM(CASE WHEN day = ? THEN n END), 0) AS today FROM counters WHERE kind = 'visit'"),
};
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// ---------- 도배 방지 ----------
const hits = new Map();
function limited(ip, action, max, windowMs) {
  const key = `${action}:${ip}`, now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of hits) if (!arr.some((t) => now - t < 600e3)) hits.delete(k);
}, 600e3).unref();

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function clean(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}
const cleanName = (v) => clean(v, 12) || '입주민';

// ---------- 내 동네 날씨 ----------
// 접속자가 사는 곳의 좌표로 지금 날씨를 받아 옵니다. 같은 동네(약 10km)는 10분 동안 한 번만 묻습니다.
const wxCache = new Map(); // "36.8,126.5" -> { at, w }
function weatherKind(code) { // WMO 날씨 코드
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code === 3) return 'cloudy';
  if (code === 2) return 'partly';
  return 'clear';
}
function symbolKind(sym = '') {
  if (sym.includes('thunder')) return 'storm';
  if (sym.includes('snow') || sym.includes('sleet')) return 'snow';
  if (sym.includes('rain') || sym.includes('drizzle')) return 'rain';
  if (sym.includes('fog')) return 'fog';
  if (sym.startsWith('cloudy')) return 'cloudy';
  if (sym.startsWith('partlycloudy')) return 'partly';
  return 'clear';
}
async function weatherFromOpenMeteo(lat, lon) {
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,precipitation&timezone=Asia%2FSeoul`, { signal: AbortSignal.timeout(12000) });
  const j = await r.json();
  if (!r.ok || j.error || !j.current) throw new Error(j.reason || String(r.status));
  const c = j.current;
  let kind = weatherKind(Number(c.weather_code));
  if (kind === 'rain' && (Number(c.precipitation) || 0) < 0.3) kind = 'cloudy'; // 예보의 ‘약한 이슬비’는 실제로는 흐리기만 한 경우가 많습니다
  return { kind, temp: Math.round(Number(c.temperature_2m)), wind: Math.round(Number(c.wind_speed_10m)) };
}
async function weatherFromMetNo(lat, lon) {
  const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`, { headers: { 'User-Agent': 'online-silvertown-weather/1.0' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(String(r.status));
  const t = (await r.json()).properties.timeseries[0].data, d = t.instant.details, n = t.next_1_hours || t.next_6_hours || {};
  let kind = symbolKind(n.summary?.symbol_code);
  if (kind === 'rain' && (Number(n.details?.precipitation_amount) || 0) < 0.6) kind = 'cloudy';
  return { kind, temp: Math.round(d.air_temperature), wind: Math.round(d.wind_speed * 3.6) };
}
async function weatherAt(lat, lon) {
  if (process.env.WEATHER === 'off') return null;
  const key = `${lat},${lon}`, hit = wxCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.w;
  let w = null;
  for (const get of [weatherFromOpenMeteo, weatherFromMetNo]) {
    try { w = await get(lat, lon); break; } catch { /* 다음 서비스로 */ }
  }
  if (!w && hit && Date.now() - hit.at < 30 * 60e3) return hit.w; // 못 받으면 조금 전 값을 30분까지 씁니다
  if (wxCache.size > 500) wxCache.clear();
  wxCache.set(key, { at: Date.now(), w });
  return w;
}

// ---------- API ----------
async function api(req, res, url) {
  const p = url.pathname, ip = clientIp(req);
  if (req.method === 'GET' && p === '/api/state') {
    const cfg = loadConfig();
    return send(res, 200, { name: cfg.name, subtitle: cfg.subtitle, schedule: cfg.schedule, presence: worldCount(), now: Date.now() });
  }
  if (req.method === 'GET' && p === '/api/weather') {
    if (limited(ip, 'wx', 20, 60e3)) return send(res, 429, { error: '잠시 후 다시 시도해 주세요.' });
    const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return send(res, 400, { error: '위치를 알 수 없습니다.' });
    return send(res, 200, { weather: await weatherAt(Math.round(lat * 10) / 10, Math.round(lon * 10) / 10) });
  }
  send(res, 404, { error: 'not found' });
}

// ---------- 정적 파일 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg',
};
const GZIP_EXT = new Set(['.html', '.css', '.js', '.json', '.svg', '.webmanifest']);
const gzCache = new Map();
function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { rel = '/'; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('찾을 수 없는 페이지입니다.');
    }
    const ext = path.extname(file);
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': /^\/(img|vendor)\//.test(rel) ? 'public, max-age=604800' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    if (GZIP_EXT.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      let hit = gzCache.get(file);
      if (!hit || hit.mtime !== st.mtimeMs) { hit = { mtime: st.mtimeMs, buf: zlib.gzipSync(fs.readFileSync(file)) }; gzCache.set(file, hit); }
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': hit.buf.length });
      return res.end(req.method === 'HEAD' ? undefined : hit.buf);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    api(req, res, url).catch((e) => { if (!res.headersSent) send(res, 400, { error: '요청을 처리하지 못했습니다.' }); else res.end(); console.error(e); });
  } else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
  else { res.writeHead(405); res.end(); }
});

// ---------- 3D 타운 (WebSocket) ----------
// 접속자는 정원이 있는 '하우스'(방)에 나뉘어 들어갑니다. 사람이 늘면 하우스가 자동으로 늘어납니다.
const ROOM_CAP = Number(process.env.ROOM_CAP) || 40;
const BOUNDS = { x: 20, z0: -14, z1: 18 };
const rooms = new Map(); // id -> Set<player>
const ipConns = new Map();
let nextPlayerId = 1, nextRoomId = 1;

function worldCount() { let n = 0; for (const r of rooms.values()) n += r.size; return n; }
function pickRoom() { // 빈자리가 있는 하우스 중 가장 붐비는 곳으로 — 혼자 남는 사람이 없도록
  let best = null;
  for (const [id, set] of rooms) if (set.size < ROOM_CAP && (!best || set.size > rooms.get(best).size)) best = id;
  if (best === null) { best = nextRoomId++; rooms.set(best, new Set()); }
  return best;
}
function roomSend(roomId, obj, except) {
  const set = rooms.get(roomId);
  if (!set) return;
  const msg = JSON.stringify(obj);
  for (const p of set) if (p !== except && p.ws.readyState === 1) p.ws.send(msg);
}
function leave(p) {
  if (p.room === null) return;
  const set = rooms.get(p.room), rid = p.room;
  p.room = null;
  if (!set) return;
  set.delete(p);
  if (!set.size) rooms.delete(rid); else roomSend(rid, { t: 'out', id: p.id });
}
const seenToday = { day: '', ips: new Set() }; // 같은 날 같은 곳에서 여러 번 들어와도 한 번으로 셉니다 (주소는 저장하지 않습니다)
function countVisit(ip) {
  const day = kstDay();
  if (seenToday.day !== day) { seenToday.day = day; seenToday.ips.clear(); }
  if (seenToday.ips.has(ip)) return;
  seenToday.ips.add(ip);
  q.bump.run(day, 'visit');
}
const pub = (p) => ({ id: p.id, name: p.name, region: p.region, leader: p.leader, look: p.look, x: p.x, z: p.z, r: p.r, a: p.a });
const num = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on('upgrade', (req, socket, head) => {
  const ip = clientIp(req);
  if (new URL(req.url, 'http://localhost').pathname !== '/ws' || (ipConns.get(ip) || 0) >= 8) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, ip));
});

function onConnect(ws, ip) {
  ipConns.set(ip, (ipConns.get(ip) || 0) + 1);
  const p = { id: nextPlayerId++, ws, ip, name: '입주민', region: '', leader: false, look: [0, 0], x: 0, z: 12, r: Math.PI, a: 0, room: null, dirty: false, alive: true };
  ws.on('pong', () => { p.alive = true; });
  ws.on('close', () => {
    const left = ipConns.get(ip) - 1;
    if (left > 0) ipConns.set(ip, left); else ipConns.delete(ip);
    leave(p);
  });
  ws.on('error', () => {});
  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'join' && p.room === null) {
      p.name = cleanName(m.name);
      p.region = clean(m.region, 8);
      p.leader = m.leader === true;
      const lk = Array.isArray(m.look) ? m.look : [];
      p.look = [8, 4].map((n, i) => (Number.isInteger(lk[i]) && lk[i] >= 0 && lk[i] < n ? lk[i] : 0)); // 옷 색 · 머리 모양
      // 같은 기기에서 다시 들어온 것이면 남아 있는 예전 접속을 먼저 내보냅니다 (자기 모습이 둘로 보이지 않게)
      p.cid = typeof m.cid === 'string' && /^[\w-]{8,32}$/.test(m.cid) ? m.cid : null;
      if (p.cid) for (const set of [...rooms.values()]) for (const o of [...set]) {
        if (o === p || o.cid !== p.cid) continue;
        leave(o);
        try { o.ws.terminate(); } catch { /* 이미 끊긴 접속 */ }
      }
      p.room = pickRoom();
      const set = rooms.get(p.room);
      countVisit(p.ip);
      ws.send(JSON.stringify({ t: 'hi', id: p.id, room: p.room, players: [...set].map(pub), total: worldCount() + 1, visits: q.visits.get(kstDay()) }));
      set.add(p);
      roomSend(p.room, { t: 'in', ...pub(p) }, p);
      return;
    }
    if (p.room === null) return;

    if (m.t === 'p') {
      const x = num(m.x, -BOUNDS.x, BOUNDS.x), z = num(m.z, BOUNDS.z0, BOUNDS.z1), r = num(m.r, -7, 7);
      if (x === null || z === null || r === null) return;
      p.x = Math.round(x * 100) / 100; p.z = Math.round(z * 100) / 100; p.r = Math.round(r * 100) / 100;
      p.a = [0, 1, 2].includes(m.a) ? m.a : 0; // 0 서 있음 · 1 앉음 · 2 체조
      p.dirty = true;
    } else if (m.t === 'hello') { // 인사 건네기
      if (limited(p.ip, 'hello', 12, 60e3)) return;
      roomSend(p.room, { t: 'hello', id: p.id }, p);
    }
  });
}

// 위치는 건별로 보내지 않고 0.1초마다 바뀐 사람만 묶어서 보냅니다.
setInterval(() => {
  for (const [id, set] of rooms) {
    const ps = [];
    for (const p of set) if (p.dirty) { ps.push([p.id, p.x, p.z, p.r, p.a]); p.dirty = false; }
    if (ps.length) roomSend(id, { t: 's', ps });
  }
}, 100).unref();

setInterval(() => {
  const total = worldCount();
  for (const [id, set] of rooms) {
    roomSend(id, { t: 'n', total });
    for (const p of set) {
      if (!p.alive) { p.ws.terminate(); continue; }
      p.alive = false; p.ws.ping();
    }
  }
}, 20000).unref();

server.listen(PORT, () => console.log(`온라인 실버타운이 열렸습니다 → http://localhost:${PORT}`));
