// 문제 보고용 진단 로그. 브라우저 안(chrome.storage.local)에만 저장하며 어디로도 전송하지 않는다.
// 사용자가 설정 페이지에서 파일로 내려받아 직접 메일 등에 첨부할 때만 밖으로 나간다.
//
// - 실행 컨텍스트(background/popup/options)마다 별도 키에 기록해 컨텍스트 간 쓰기 경합을 피한다.
// - init()을 호출하기 전에는 아무것도 기록하지 않으므로 테스트나 미리보기에서 import해도 안전하다.
// - 토큰은 기록하지 않으며, 이메일·토큰·비밀번호처럼 보이는 키는 기록 시점에 가린다.

export const LOG_KEY_PREFIX = 'diagLog:';
export const MAX_ENTRIES = 300; // 컨텍스트별 최대 항목 수
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7일이 지난 항목은 버린다.
export const MAX_BODY_CHARS = 8000; // 응답 본문 하나의 최대 길이
const MAX_DEPTH = 8;
const FLUSH_DELAY_MS = 300;
const REDACTED = '[redacted]';
const SENSITIVE_KEY = /e-?mail|token|password|passwd|secret|authorization|cookie/i;

const state = {
  source: null,
  captureBodies: false,
  pending: [],
  timer: 0,
  chain: Promise.resolve(),
};

// 민감해 보이는 키를 가리고, 깊이와 순환 참조를 제한한 사본을 만든다.
export function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > MAX_BODY_CHARS) return `${value.slice(0, MAX_BODY_CHARS)}…`;
    return value;
  }
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[depth]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1, seen));
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) && v !== '' && v != null ? REDACTED : sanitize(v, depth + 1, seen);
  }
  return out;
}

// 응답 본문을 정리한 뒤 길이를 제한한 JSON 문자열로 만든다.
export function summarizeBody(data) {
  let text;
  try {
    text = JSON.stringify(sanitize(data));
  } catch {
    return '[unserializable]';
  }
  if (text === undefined) return undefined;
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}… (${text.length}자 중 일부)` : text;
}

export function describeErr(err) {
  if (err == null) return undefined;
  if (typeof err !== 'object') return String(err);
  const out = { name: err.name, message: err.message };
  if (err.status !== undefined) out.status = err.status;
  if (err.url) out.url = err.url;
  if (err.stack) out.stack = String(err.stack).split('\n').slice(0, 6).join('\n');
  return out;
}

// 오래된 항목과 개수 초과분을 버린다.
export function prune(entries, now = Date.now()) {
  return entries.filter((e) => now - e.t < RETENTION_MS).slice(-MAX_ENTRIES);
}

// 여러 컨텍스트의 기록을 시간순으로 합친다.
export function mergeEntries(bySource) {
  return Object.values(bySource)
    .flat()
    .filter((e) => e && typeof e.t === 'number')
    .sort((a, b) => a.t - b.t);
}

// 모든 문자열에서 needle을 바꾼다. 빈 needle은 무시한다.
export function replaceAll(text, needle, replacement) {
  return needle ? text.split(needle).join(replacement) : text;
}

function add(level, message, data) {
  if (!state.source) return;
  const entry = { t: Date.now(), src: state.source, level, msg: String(message) };
  if (data !== undefined) entry.data = sanitize(data);
  state.pending.push(entry);
  clearTimeout(state.timer);
  state.timer = setTimeout(flush, FLUSH_DELAY_MS);
}

export function flush() {
  clearTimeout(state.timer);
  if (!state.source || state.pending.length === 0) return state.chain;
  const batch = state.pending.splice(0);
  const key = LOG_KEY_PREFIX + state.source;
  // 같은 컨텍스트 안의 쓰기는 순서대로 실행해 덮어쓰기를 막는다.
  state.chain = state.chain
    .then(async () => {
      const stored = (await chrome.storage.local.get(key))[key];
      const entries = prune([...(Array.isArray(stored) ? stored : []), ...batch]);
      await chrome.storage.local.set({ [key]: entries });
    })
    .catch((err) => console.warn('[Gitea PR Status] 진단 로그 저장 실패', err));
  return state.chain;
}

export const diag = {
  info: (message, data) => add('info', message, data),
  warn(message, err) {
    console.warn(`[Gitea PR Status] ${message}`, err ?? '');
    add('warn', message, describeErr(err));
  },
  error(message, err) {
    console.error(`[Gitea PR Status] ${message}`, err ?? '');
    add('error', message, describeErr(err));
  },
  // API 호출 기록. 본문은 사용자가 '응답 본문 기록'을 켰을 때만 남긴다.
  api(record, body) {
    if (!state.source) return;
    const data = { ...record };
    if (body !== undefined && state.captureBodies) data.body = summarizeBody(body);
    add(record.ok ? 'info' : 'warn', 'api', data);
  },
  get captureBodies() {
    return state.captureBodies;
  },
};

// 각 진입점(background.js, popup.js, options.js)에서 한 번 호출한다.
export function initDiagnostics(source) {
  if (state.source || typeof chrome === 'undefined' || !chrome.storage?.local) return;
  state.source = source;

  chrome.storage.local
    .get('settings')
    .then(({ settings }) => {
      state.captureBodies = Boolean(settings?.diagnostics?.captureBodies);
    })
    .catch(() => {});
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      state.captureBodies = Boolean(changes.settings.newValue?.diagnostics?.captureBodies);
    }
  });

  self.addEventListener?.('error', (e) => add('error', 'uncaught', describeErr(e.error ?? e.message)));
  self.addEventListener?.('unhandledrejection', (e) => add('error', 'unhandledrejection', describeErr(e.reason)));
  // 팝업은 닫힐 때 바로 종료되므로 가능한 한 남은 기록을 저장한다.
  self.addEventListener?.('pagehide', () => flush());
}

async function readAllLogs() {
  const all = await chrome.storage.local.get(null);
  const bySource = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(LOG_KEY_PREFIX) && Array.isArray(value)) bySource[key.slice(LOG_KEY_PREFIX.length)] = value;
  }
  return { all, bySource };
}

export async function clearLogs() {
  state.pending.length = 0;
  await flush();
  const { bySource } = await readAllLogs();
  await chrome.storage.local.remove(Object.keys(bySource).map((s) => LOG_KEY_PREFIX + s));
}

// 덤프에 넣을 환경 정보. 토큰은 설정 여부만 남긴다.
function summarizeState(all, granted) {
  const settings = all.settings ?? {};
  const cache = all.cache;
  const notifyState = all.notifyState;
  return {
    settings: {
      ...sanitize({ ...settings, token: undefined }),
      token: settings.token ? `(설정됨, ${settings.token.length}자)` : '(없음)',
    },
    hostPermissionGranted: granted,
    cache: cache
      ? {
          baseUrl: cache.baseUrl,
          fetchedAt: cache.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null,
          warning: cache.warning ?? null,
          counts: Object.fromEntries(Object.entries(cache.tabs ?? {}).map(([k, v]) => [k, v?.length ?? 0])),
        }
      : null,
    notifyState: notifyState
      ? {
          baseUrl: notifyState.baseUrl,
          floor: new Date(notifyState.floorMs).toISOString(),
          cursor: new Date(notifyState.cursorMs).toISOString(),
          seenCount: notifyState.seen?.length ?? 0,
          checksTracked: Object.keys(notifyState.checks ?? {}).length,
          checksReady: notifyState.checksReady,
        }
      : null,
  };
}

// 다운로드할 진단 보고서(JSON 문자열)를 만든다. maskHost가 켜져 있으면 Gitea 호스트 이름을 가린다.
export async function buildReport({ maskHost = true, granted = null } = {}) {
  await flush();
  const { all, bySource } = await readAllLogs();
  const manifest = chrome.runtime.getManifest();
  const report = {
    format: 'gitea-pr-status-diagnostics/1',
    generatedAt: new Date().toISOString(),
    extension: { name: manifest.name, version: manifest.version },
    environment: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    options: { hostMasked: maskHost, bodiesCaptured: state.captureBodies },
    state: summarizeState(all, granted),
    entries: mergeEntries(bySource).map((e) => ({ ...e, t: new Date(e.t).toISOString() })),
  };

  let text = JSON.stringify(report, null, 2);
  // 혹시 남아 있을 수 있는 토큰 원문은 항상 지운다.
  text = replaceAll(text, all.settings?.token, REDACTED);
  if (maskHost && all.settings?.baseUrl) {
    try {
      text = replaceAll(text, new URL(all.settings.baseUrl).host, 'gitea.invalid');
    } catch {
      // 주소가 올바르지 않으면 가릴 호스트도 없다.
    }
  }
  return text;
}

export function reportFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `gitea-pr-status-log-${stamp}.json`;
}
