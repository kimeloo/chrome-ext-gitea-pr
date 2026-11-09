import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BODY_CHARS,
  MAX_ENTRIES,
  RETENTION_MS,
  diag,
  mergeEntries,
  prune,
  replaceAll,
  reportFileName,
  sanitize,
  summarizeBody,
} from '../extension/src/diagnostics.js';

test('sanitize: 이메일·토큰·비밀번호 키는 중첩 위치에서도 가린다', () => {
  const out = sanitize({
    user: { login: 'alice', email: 'a@example.com', avatar_url: 'https://x/a.png' },
    list: [{ access_token: 'abc', Password: 'p' }],
    authorization: 'token xyz',
  });
  assert.equal(out.user.login, 'alice');
  assert.equal(out.user.email, '[redacted]');
  assert.equal(out.user.avatar_url, 'https://x/a.png');
  assert.equal(out.list[0].access_token, '[redacted]');
  assert.equal(out.list[0].Password, '[redacted]');
  assert.equal(out.authorization, '[redacted]');
});

test('sanitize: 빈 값은 그대로 두어 설정 여부를 구분할 수 있다', () => {
  assert.deepEqual(sanitize({ email: '', token: null }), { email: '', token: null });
});

test('sanitize: 순환 참조와 원본 변경 없음', () => {
  const a = { name: 'a', email: 'x@y' };
  a.self = a;
  const out = sanitize(a);
  assert.equal(out.self, '[circular]');
  assert.equal(a.email, 'x@y');
});

test('summarizeBody: 긴 본문은 잘라낸다', () => {
  const body = summarizeBody(Array.from({ length: 2000 }, (_, i) => ({ id: i, title: 'title' })));
  assert.ok(body.length < MAX_BODY_CHARS + 50);
  assert.match(body, /일부\)$/);
});

test('prune: 보존 기간이 지난 항목과 개수 초과분을 버린다', () => {
  const now = 10 * RETENTION_MS;
  const old = { t: now - RETENTION_MS - 1, msg: 'old' };
  const fresh = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => ({ t: now - 1000 + i, msg: String(i) }));
  const out = prune([old, ...fresh], now);
  assert.equal(out.length, MAX_ENTRIES);
  assert.equal(out.includes(old), false);
  assert.equal(out.at(-1).msg, String(MAX_ENTRIES + 4));
});

test('mergeEntries: 컨텍스트별 기록을 시간순으로 합치고 잘못된 항목은 버린다', () => {
  const merged = mergeEntries({
    background: [{ t: 3, src: 'background' }, { t: 1, src: 'background' }],
    popup: [{ t: 2, src: 'popup' }, null, { src: 'popup' }],
  });
  assert.deepEqual(merged.map((e) => e.t), [1, 2, 3]);
});

test('replaceAll: 모든 위치를 바꾸고 빈 needle은 무시', () => {
  assert.equal(replaceAll('a.git.example.com/b git.example.com', 'git.example.com', 'h'), 'a.h/b h');
  assert.equal(replaceAll('abc', '', 'x'), 'abc');
  assert.equal(replaceAll('abc', undefined, 'x'), 'abc');
});

test('reportFileName: 로컬 시각 기반 파일 이름', () => {
  assert.equal(reportFileName(new Date(2026, 0, 2, 3, 4, 5)), 'gitea-pr-status-log-20260102-030405.json');
});

test('diag: init 전에는 chrome 없이 호출해도 아무것도 하지 않는다', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    diag.info('x');
    diag.api({ ok: true, url: 'https://x' }, { a: 1 });
    diag.warn('y', new Error('e'));
  } finally {
    console.warn = warn;
  }
  assert.equal(diag.captureBodies, false);
});
