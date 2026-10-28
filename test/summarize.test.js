import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectParticipants,
  countReviewStates,
  summarizeChecks,
  summarizeReviews,
} from '../extension/src/summarize.js';

const user = (login) => ({ login, avatar_url: `https://img.example/${login}.png` });
const review = (id, login, state, extra = {}) => ({ id, user: user(login), state, ...extra });
const find = (list, login) => list.find((r) => r.login === login);

test('summarizeReviews: 승인 후 코멘트는 approved 유지', () => {
  const out = summarizeReviews({
    authorLogin: 'me',
    reviews: [review(1, 'alice', 'APPROVED'), review(2, 'alice', 'COMMENT')],
  });
  assert.equal(out.length, 1);
  assert.equal(find(out, 'alice').state, 'approved');
});

test('summarizeReviews: 변경 요청 후 승인은 approved', () => {
  const out = summarizeReviews({
    authorLogin: 'me',
    reviews: [review(1, 'alice', 'REQUEST_CHANGES'), review(2, 'alice', 'APPROVED')],
  });
  assert.equal(find(out, 'alice').state, 'approved');
});

test('summarizeReviews: id가 더 큰 재요청은 pending이 된다', () => {
  const out = summarizeReviews({
    authorLogin: 'me',
    reviews: [review(1, 'alice', 'APPROVED'), review(2, 'alice', 'REQUEST_REVIEW')],
  });
  assert.equal(find(out, 'alice').state, 'pending');
});

test('summarizeReviews: 입력 순서와 무관하게 id 오름차순으로 판단한다', () => {
  const out = summarizeReviews({
    authorLogin: 'me',
    reviews: [review(2, 'alice', 'APPROVED'), review(1, 'alice', 'REQUEST_CHANGES')],
  });
  assert.equal(find(out, 'alice').state, 'approved');
});

test('summarizeReviews: stale 승인은 stale이 true', () => {
  const out = summarizeReviews({
    authorLogin: 'me',
    reviews: [review(1, 'alice', 'APPROVED', { stale: true }), review(2, 'bob', 'APPROVED')],
  });
  assert.equal(find(out, 'alice').state, 'approved');
  assert.equal(find(out, 'alice').stale, true);
  assert.equal(find(out, 'bob').stale, false);
});

test('summarizeReviews: dismissed 승인만 있는 사용자는 결과에 없다', () => {
  const out = summarizeReviews({
    authorLogin: 'me',
    reviews: [review(1, 'alice', 'APPROVED', { dismissed: true })],
  });
  assert.equal(find(out, 'alice'), undefined);
  assert.deepEqual(out, []);
});

test('summarizeReviews: requested에만 있는 사용자는 pending', () => {
  const out = summarizeReviews({ authorLogin: 'me', requested: [user('carol')], reviews: [] });
  assert.equal(out.length, 1);
  assert.equal(find(out, 'carol').state, 'pending');
  assert.equal(find(out, 'carol').stale, false);
  assert.equal(find(out, 'carol').avatarUrl, 'https://img.example/carol.png');
});

test('summarizeReviews: 대기 중인 요청이 과거 승인을 덮어쓴다', () => {
  const out = summarizeReviews({
    authorLogin: 'me',
    requested: [user('alice')],
    reviews: [review(1, 'alice', 'APPROVED', { stale: true })],
  });
  assert.equal(find(out, 'alice').state, 'pending');
  assert.equal(find(out, 'alice').stale, false);
});

test('summarizeReviews: 작성자 본인의 리뷰와 요청은 제외', () => {
  const out = summarizeReviews({
    authorLogin: 'me',
    requested: [user('me')],
    reviews: [review(1, 'me', 'COMMENT')],
  });
  assert.deepEqual(out, []);
});

test('summarizeReviews: user가 null인 팀 리뷰 요청은 제외', () => {
  const out = summarizeReviews({
    authorLogin: 'me',
    reviews: [{ id: 1, user: null, state: 'REQUEST_REVIEW' }],
  });
  assert.deepEqual(out, []);
});

test('summarizeReviews: 코멘트만 남긴 사용자는 commented, PENDING은 무시', () => {
  const out = summarizeReviews({
    authorLogin: 'me',
    reviews: [review(1, 'alice', 'COMMENT'), review(2, 'bob', 'PENDING')],
  });
  assert.equal(out.length, 1);
  assert.equal(find(out, 'alice').state, 'commented');
});

test('summarizeReviews: 결과 순서는 엔트리 최초 생성 순서', () => {
  const out = summarizeReviews({
    authorLogin: 'me',
    requested: [user('zed')],
    reviews: [review(1, 'bob', 'APPROVED'), review(2, 'alice', 'REQUEST_CHANGES')],
  });
  assert.deepEqual(out.map((r) => r.login), ['bob', 'alice', 'zed']);
});

test('countReviewStates: 상태별 개수를 센다', () => {
  const counts = countReviewStates([
    { state: 'approved' },
    { state: 'approved' },
    { state: 'pending' },
    { state: 'commented' },
  ]);
  assert.deepEqual(counts, { approved: 2, changes_requested: 0, pending: 1, commented: 1 });
});

test('summarizeChecks: null 또는 빈 statuses는 null', () => {
  assert.equal(summarizeChecks(null), null);
  assert.equal(summarizeChecks(undefined), null);
  assert.equal(summarizeChecks({ state: '', statuses: [] }), null);
  assert.equal(summarizeChecks({ state: 'pending' }), null);
});

test('summarizeChecks: success와 failure가 섞이면 failure', () => {
  const out = summarizeChecks({
    statuses: [
      { context: 'build', status: 'success' },
      { context: 'test', status: 'failure', description: 'boom', target_url: 'http://x/t' },
    ],
  });
  assert.equal(out.state, 'failure');
  assert.equal(out.success, 1);
  assert.equal(out.failure, 1);
  assert.equal(out.total, 2);
  assert.deepEqual(out.items, [
    { context: 'build', status: 'success', description: '', targetUrl: '' },
    { context: 'test', status: 'failure', description: 'boom', targetUrl: 'http://x/t' },
  ]);
});

test('summarizeChecks: error는 failure로 집계', () => {
  const out = summarizeChecks({ statuses: [{ context: 'a', status: 'error' }] });
  assert.equal(out.state, 'failure');
  assert.equal(out.failure, 1);
});

test('summarizeChecks: warning과 pending이 섞이면 warning', () => {
  const out = summarizeChecks({
    statuses: [
      { context: 'a', status: 'warning' },
      { context: 'b', status: 'pending' },
    ],
  });
  assert.equal(out.state, 'warning');
  assert.equal(out.warning, 1);
  assert.equal(out.pending, 1);
});

test('summarizeChecks: pending과 success가 섞이면 pending', () => {
  const out = summarizeChecks({
    statuses: [
      { context: 'a', status: 'pending' },
      { context: 'b', status: 'success' },
    ],
  });
  assert.equal(out.state, 'pending');
});

test('summarizeChecks: 전부 success면 success', () => {
  const out = summarizeChecks({
    statuses: [
      { context: 'a', status: 'success' },
      { context: 'b', status: 'success' },
    ],
  });
  assert.equal(out.state, 'success');
  assert.equal(out.success, 2);
  assert.equal(out.total, 2);
});

test('summarizeChecks: skipped만 있으면 neutral이고 total에만 포함', () => {
  const out = summarizeChecks({ statuses: [{ context: 'a', status: 'skipped' }] });
  assert.equal(out.state, 'neutral');
  assert.equal(out.total, 1);
  assert.equal(out.success + out.failure + out.warning + out.pending, 0);
});

test('collectParticipants: 작성자가 첫 번째이고 댓글과 리뷰 사이 중복은 제거', () => {
  const out = collectParticipants({
    author: { login: 'me', avatarUrl: 'https://img.example/me.png' },
    comments: [{ user: user('alice') }, { user: user('me') }, { user: user('alice') }],
    reviews: [review(1, 'alice', 'APPROVED'), review(2, 'bob', 'COMMENT')],
  });
  assert.deepEqual(out.map((u) => u.login), ['me', 'alice', 'bob']);
  assert.equal(out[0].avatarUrl, 'https://img.example/me.png');
  assert.equal(out[1].avatarUrl, 'https://img.example/alice.png');
});

test('collectParticipants: REQUEST_REVIEW와 PENDING 리뷰어는 제외', () => {
  const out = collectParticipants({
    author: { login: 'me', avatarUrl: '' },
    reviews: [
      review(1, 'req', 'REQUEST_REVIEW'),
      review(2, 'pend', 'PENDING'),
      review(3, 'done', 'REQUEST_CHANGES'),
    ],
  });
  assert.deepEqual(out.map((u) => u.login), ['me', 'done']);
});

test('collectParticipants: null 사용자는 건너뛴다', () => {
  const out = collectParticipants({
    author: null,
    comments: [{ user: null }, { user: user('alice') }],
    reviews: [{ id: 1, user: null, state: 'APPROVED' }],
  });
  assert.deepEqual(out.map((u) => u.login), ['alice']);
});
