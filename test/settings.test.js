import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  FIELD_DEFS,
  FIELD_GROUPS,
  NOTIFY_EVENT_DEFS,
  loadSettings,
  normalizeBaseUrl,
  originPattern,
} from '../extension/src/settings.js';

test('normalizeBaseUrl: 스킴이 없으면 https를 붙이고 끝의 슬래시를 제거', () => {
  assert.equal(normalizeBaseUrl('git.example.com/'), 'https://git.example.com');
});

test('normalizeBaseUrl: 포트와 하위 경로를 유지', () => {
  assert.equal(normalizeBaseUrl('http://host:3000/gitea/'), 'http://host:3000/gitea');
});

test('normalizeBaseUrl: 앞뒤 공백 제거, 쿼리와 해시 제거', () => {
  assert.equal(normalizeBaseUrl('  https://git.example.com/a?x=1#h  '), 'https://git.example.com/a');
});

test('normalizeBaseUrl: 빈 문자열은 빈 문자열', () => {
  assert.equal(normalizeBaseUrl(''), '');
  assert.equal(normalizeBaseUrl('   '), '');
});

test('normalizeBaseUrl: http/https 이외 스킴은 거부', () => {
  assert.throws(() => normalizeBaseUrl('ftp://x'), /invalid-url/);
});

test('normalizeBaseUrl: 잘못된 호스트는 거부', () => {
  assert.throws(() => normalizeBaseUrl('https://bad host'), /invalid-url/);
});

test('originPattern: 포트를 포함하고 경로는 와일드카드', () => {
  assert.equal(originPattern('http://host:3000/gitea'), 'http://host:3000/*');
  assert.equal(originPattern('https://git.example.com'), 'https://git.example.com/*');
});

test('FIELD_DEFS: 키가 중복되지 않고 그룹이 FIELD_GROUPS에 존재', () => {
  const keys = FIELD_DEFS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
  const groups = new Set(FIELD_GROUPS.map((g) => g.key));
  for (const f of FIELD_DEFS) assert.ok(groups.has(f.group), f.key);
});

function stubChrome(stored) {
  globalThis.chrome = { storage: { local: { get: async () => ({ settings: stored }) } } };
}

test('loadSettings: 저장값이 없으면 기본값을 반환', async () => {
  stubChrome(undefined);
  try {
    assert.deepEqual(await loadSettings(), DEFAULT_SETTINGS);
  } finally {
    delete globalThis.chrome;
  }
});

test('loadSettings: 저장된 fields에 없는 항목은 기본값으로 병합', async () => {
  stubChrome({ baseUrl: 'https://git.example.com', token: 't', theme: 'dark', fields: { labels: false } });
  try {
    const s = await loadSettings();
    assert.equal(s.baseUrl, 'https://git.example.com');
    assert.equal(s.theme, 'dark');
    assert.equal(s.fields.labels, false);
    assert.equal(s.fields.owner, true);
    assert.equal(Object.keys(s.fields).length, FIELD_DEFS.length);
  } finally {
    delete globalThis.chrome;
  }
});

test('loadSettings: 저장된 notify는 기본값과 병합하고 허용되지 않는 확인 주기는 5분으로 대체', async () => {
  try {
    stubChrome({ notify: { enabled: true, events: { comment: false } } });
    const partial = (await loadSettings()).notify;
    assert.equal(partial.enabled, true);
    assert.equal(partial.intervalMinutes, 5);
    assert.equal(partial.events.comment, false);
    assert.equal(partial.events.merged, true);
    assert.equal(Object.keys(partial.events).length, NOTIFY_EVENT_DEFS.length);

    stubChrome({ notify: { enabled: true, intervalMinutes: 7 } });
    assert.equal((await loadSettings()).notify.intervalMinutes, 5);

    stubChrome({ notify: { intervalMinutes: 15 } });
    assert.equal((await loadSettings()).notify.intervalMinutes, 15);
  } finally {
    delete globalThis.chrome;
  }
});

test('loadSettings: 저장된 tabOrder는 알 수 없는 키와 중복을 버리고 빠진 탭을 뒤에 붙이며, 없으면 기본 순서', async () => {
  try {
    stubChrome({ tabOrder: ['mentioned', 'bogus', 'created', 'mentioned'] });
    assert.deepEqual((await loadSettings()).tabOrder, ['mentioned', 'created', 'reviewRequested', 'assigned', 'reviewed']);

    stubChrome({});
    assert.deepEqual((await loadSettings()).tabOrder, DEFAULT_SETTINGS.tabOrder);
  } finally {
    delete globalThis.chrome;
  }
});
