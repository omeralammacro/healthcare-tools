// Dubber dashboard backend.
// Node 18+ required (uses built-in fetch). No npm install needed.
//
// Run:
//   1. Copy .env.example to .env, fill credentials
//   2. node server.js   (or double-click run.bat)
//   3. Open http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// --- minimal .env loader (no dependency on dotenv) ---
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('Missing .env file. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

const REGION = process.env.DUBBER_REGION || 'us';
const ACCOUNT_ID = process.env.DUBBER_ACCOUNT_ID;
const AUTH_ID = process.env.DUBBER_AUTH_ID;
const AUTH_TOKEN = process.env.DUBBER_AUTH_TOKEN;
const CLIENT_ID = process.env.DUBBER_CLIENT_ID;
const CLIENT_SECRET = process.env.DUBBER_CLIENT_SECRET;
const PORT = Number(process.env.PORT || 3000);

const SHIFT_START = process.env.SHIFT_START || '09:00';
const SHIFT_END = process.env.SHIFT_END || '18:00';
const SHIFT_TZ = process.env.SHIFT_TIMEZONE || 'Asia/Kolkata';
const BREAK_GAP_MIN = Number(process.env.BREAK_GAP_MINUTES || 15);

const BASE = `https://api.dubber.net/${REGION}/v1`;

if (!ACCOUNT_ID || !AUTH_ID || !AUTH_TOKEN || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing one or more required env vars. Check .env (DUBBER_ACCOUNT_ID, DUBBER_AUTH_ID, DUBBER_AUTH_TOKEN, DUBBER_CLIENT_ID, DUBBER_CLIENT_SECRET).');
  process.exit(1);
}

// --- OAuth token cache ---
let tokenCache = { token: null, expiresAt: 0 };

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    username: AUTH_ID,
    password: AUTH_TOKEN,
    grant_type: 'password',
  }).toString();

  const res = await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${text.slice(0, 300)}`);
  }
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Token response not JSON: ${text.slice(0, 300)}`); }
  const expiresIn = Number(json.expires_in || 86400);
  tokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return tokenCache.token;
}

// --- Recordings fetch (paginated) ---
async function fetchRecordings({ fromIso, toIso }) {
  const token = await getToken();
  const out = [];
  let url = `${BASE}/accounts/${ACCOUNT_ID}/recordings?count=200&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;
  let safety = 0;
  while (url && safety < 50) {
    safety++;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Recordings fetch failed: ${res.status} ${text.slice(0, 300)}`);
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`Recordings response not JSON: ${text.slice(0, 300)}`); }
    const items = json.recordings || json.items || json.data || [];
    out.push(...items);
    // Try common pagination shapes
    const next = json.next || (json._links && json._links.next && (json._links.next.href || json._links.next))
                  || (json.meta && json.meta.next);
    url = next || null;
    if (typeof url === 'string' && url.startsWith('/')) url = `${BASE.replace(/\/v1$/, '')}${url}`;
  }
  return out;
}

// --- Helpers: timezone-aware shift bounds ---
function localPartsForDate(date, tz) {
  // Returns { y, m, d } for the given date in tz.
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmt.formatToParts(date).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  return { y: parts.year, m: parts.month, d: parts.day };
}

function tzOffsetMs(date, tz) {
  // Compute offset of tz relative to UTC at the given instant.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce((a, p) => (a[p.type] = p.value, a), {});
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUTC - date.getTime();
}

function dayBoundsInTz(yyyymmdd, tz, startHHMM, endHHMM) {
  // yyyymmdd like "2026-04-29". Returns { startUtc, endUtc } as Date.
  const [Y, M, D] = yyyymmdd.split('-').map(Number);
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  // Construct an approximate UTC instant for start, then fix using tz offset
  const approxStart = new Date(Date.UTC(Y, M - 1, D, sh, sm));
  const offStart = tzOffsetMs(approxStart, tz);
  const startUtc = new Date(approxStart.getTime() - offStart);
  const approxEnd = new Date(Date.UTC(Y, M - 1, D, eh, em));
  const offEnd = tzOffsetMs(approxEnd, tz);
  const endUtc = new Date(approxEnd.getTime() - offEnd);
  return { startUtc, endUtc };
}

// --- Recording normalization ---
function pickStartTime(r) {
  return r.started_at || r.start_time || r.startTime || r.created_at || r.createdAt || r.timestamp || null;
}
function pickEndTime(r) {
  return r.ended_at || r.end_time || r.endTime || r.finished_at || null;
}
function pickDurationSec(r, startMs, endMs) {
  if (typeof r.duration === 'number') {
    // Could be seconds or ms. Heuristic: > 1e7 means ms.
    return r.duration > 1e7 ? Math.round(r.duration / 1000) : r.duration;
  }
  if (typeof r.duration_seconds === 'number') return r.duration_seconds;
  if (typeof r.durationMs === 'number') return Math.round(r.durationMs / 1000);
  if (startMs && endMs) return Math.max(0, Math.round((endMs - startMs) / 1000));
  return 0;
}
function pickDirection(r) {
  const raw = (r.direction || r.call_direction || '').toString().toLowerCase();
  if (raw.includes('in')) return 'incoming';
  if (raw.includes('out')) return 'outgoing';
  // Fall back: if `to` looks internal and `from` looks external => incoming, vice versa.
  return 'unknown';
}
function pickUser(r) {
  // Try several common shapes; fall back to channel/from/to.
  const u = r.user || r.owner || r.recorded_user || r.endpoint || {};
  const name = u.display_name || u.name || u.username || u.email
            || r.user_name || r.username || r.owner_name || r.recorded_party
            || r.service_id || r.endpoint_name || null;
  const id = u.id || u.user_id || r.user_id || r.owner_id || r.endpoint_id || name || 'unknown';
  return { id: String(id), name: name || String(id) };
}

// --- Aggregation ---
function aggregate(recordings, dayBounds) {
  const totals = { calls: 0, incoming: 0, outgoing: 0, unknown: 0 };
  const byUser = new Map();

  // Sort by start time for break detection
  const enriched = recordings.map(r => {
    const startStr = pickStartTime(r);
    const endStr = pickEndTime(r);
    const startMs = startStr ? Date.parse(startStr) : null;
    const endMs = endStr ? Date.parse(endStr) : null;
    return {
      raw: r,
      startMs,
      endMs,
      durationSec: pickDurationSec(r, startMs, endMs),
      direction: pickDirection(r),
      user: pickUser(r),
    };
  }).filter(e => e.startMs && !isNaN(e.startMs));

  enriched.sort((a, b) => a.startMs - b.startMs);

  for (const e of enriched) {
    totals.calls++;
    totals[e.direction]++;
    let u = byUser.get(e.user.id);
    if (!u) {
      u = {
        id: e.user.id,
        name: e.user.name,
        calls: 0, incoming: 0, outgoing: 0, unknown: 0,
        totalCallSeconds: 0,
        firstCallAt: null, lastCallAt: null,
        events: [], // for break detection & timeline
      };
      byUser.set(e.user.id, u);
    }
    u.calls++;
    u[e.direction]++;
    u.totalCallSeconds += e.durationSec || 0;
    if (!u.firstCallAt || e.startMs < u.firstCallAt) u.firstCallAt = e.startMs;
    const callEnd = e.endMs || (e.startMs + (e.durationSec || 0) * 1000);
    if (!u.lastCallAt || callEnd > u.lastCallAt) u.lastCallAt = callEnd;
    u.events.push({ start: e.startMs, end: callEnd, direction: e.direction });
  }

  // Compute breaks per user (gaps >= BREAK_GAP_MIN within shift window)
  const shiftStart = dayBounds.startUtc.getTime();
  const shiftEnd = dayBounds.endUtc.getTime();
  const gapThresh = BREAK_GAP_MIN * 60_000;

  const users = Array.from(byUser.values()).map(u => {
    u.events.sort((a, b) => a.start - b.start);
    // Merge overlapping call intervals
    const merged = [];
    for (const ev of u.events) {
      const s = Math.max(ev.start, shiftStart);
      const e = Math.min(ev.end, shiftEnd);
      if (e <= s) continue;
      if (merged.length && s <= merged[merged.length - 1].end) {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, e);
      } else {
        merged.push({ start: s, end: e });
      }
    }
    // Find gaps between shift start, merged calls, and shift end
    const breaks = [];
    let cursor = shiftStart;
    for (const m of merged) {
      const gap = m.start - cursor;
      if (gap >= gapThresh) {
        breaks.push({ startMs: cursor, endMs: m.start, durationSec: Math.round(gap / 1000) });
      }
      cursor = m.end;
    }
    const tailGap = shiftEnd - cursor;
    if (tailGap >= gapThresh && cursor > shiftStart) {
      breaks.push({ startMs: cursor, endMs: shiftEnd, durationSec: Math.round(tailGap / 1000) });
    }
    const totalBreakSec = breaks.reduce((s, b) => s + b.durationSec, 0);

    // Hourly histogram across the shift window
    const hours = Math.max(1, Math.ceil((shiftEnd - shiftStart) / 3_600_000));
    const histogram = new Array(hours).fill(0).map(() => ({ incoming: 0, outgoing: 0, unknown: 0 }));
    for (const ev of u.events) {
      if (ev.start < shiftStart || ev.start >= shiftEnd) continue;
      const idx = Math.floor((ev.start - shiftStart) / 3_600_000);
      if (idx >= 0 && idx < histogram.length) histogram[idx][ev.direction] += 1;
    }
    return {
      id: u.id,
      name: u.name,
      calls: u.calls,
      incoming: u.incoming,
      outgoing: u.outgoing,
      unknown: u.unknown,
      totalCallSeconds: u.totalCallSeconds,
      firstCallAt: u.firstCallAt ? new Date(u.firstCallAt).toISOString() : null,
      lastCallAt: u.lastCallAt ? new Date(u.lastCallAt).toISOString() : null,
      breaks: breaks.map(b => ({
        startAt: new Date(b.startMs).toISOString(),
        endAt: new Date(b.endMs).toISOString(),
        durationSec: b.durationSec,
      })),
      totalBreakSeconds: totalBreakSec,
      breakCount: breaks.length,
      histogram,
      callIntervals: merged.map(m => ({
        startAt: new Date(m.start).toISOString(),
        endAt: new Date(m.end).toISOString(),
      })),
    };
  });

  users.sort((a, b) => b.calls - a.calls);

  return {
    shift: {
      start: dayBounds.startUtc.toISOString(),
      end: dayBounds.endUtc.toISOString(),
      timezone: SHIFT_TZ,
      breakGapMinutes: BREAK_GAP_MIN,
    },
    totals,
    users,
  };
}

// --- HTTP server ---
function todayInTz(tz) {
  const { y, m, d } = localPartsForDate(new Date(), tz);
  return `${y}-${m}-${d}`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function serveFile(res, filepath, contentType) {
  fs.readFile(filepath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      return serveFile(res, path.join(__dirname, 'public', 'index.html'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && u.pathname === '/api/calls') {
      const date = u.searchParams.get('date') || todayInTz(SHIFT_TZ);
      const bounds = dayBoundsInTz(date, SHIFT_TZ, SHIFT_START, SHIFT_END);
      // Fetch slightly wider window so calls partly outside the shift still show
      const fromIso = new Date(bounds.startUtc.getTime() - 30 * 60_000).toISOString();
      const toIso = new Date(bounds.endUtc.getTime() + 30 * 60_000).toISOString();
      const recordings = await fetchRecordings({ fromIso, toIso });
      const agg = aggregate(recordings, bounds);
      return send(res, 200, {
        date,
        fetchedAt: new Date().toISOString(),
        recordingCount: recordings.length,
        ...agg,
      });
    }
    if (req.method === 'GET' && u.pathname === '/api/health') {
      return send(res, 200, { ok: true });
    }
    res.writeHead(404); res.end('Not found');
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Dubber dashboard server running at http://localhost:${PORT}`);
  console.log(`Region=${REGION}  Account=${ACCOUNT_ID}  Shift=${SHIFT_START}-${SHIFT_END} ${SHIFT_TZ}  BreakGap=${BREAK_GAP_MIN}min`);
});
