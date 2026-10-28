import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNotifications,
  checkTransition,
  eventsFromTimeline,
  newPullEvent,
  notificationId,
  settingKeyOf,
  urlFromNotificationId,
} from '../extension/src/notify.js';
import { NOTIFY_EVENT_DEFS } from '../extension/src/settings.js';

const PR_URL = 'https://git.example.com/acme/web/pulls/1';
const SINCE = '2026-01-01T00:00:00Z';
const AFTER = '2026-01-01T00:05:00Z';
const BEFORE = '2025-12-31T23:59:59Z';
const ctx = { me: 'me', sinceMs: Date.parse(SINCE), prUrl: PR_URL };

const timelineItem = (over) => ({
  id: 1,
  type: 'comment',
  user: { login: 'alice' },
  html_url: `${PR_URL}#issuecomment-1`,
  created_at: AFTER,
  ...over,
});

test('settingKeyOf: 이벤트 종류를 설정 키로 변환하며 모든 결과가 설정 정의에 존재', () => {
  assert.equal(settingKeyOf('closed'), 'closedReopened');
  assert.equal(settingKeyOf('reopened'), 'closedReopened');
  assert.equal(settingKeyOf('checkSuccess'), 'checks');
  assert.equal(settingKeyOf('checkFailure'), 'checks');
  assert.equal(settingKeyOf('checkWarning'), 'checks');
  const kinds = [
    'newPull', 'reviewRequested', 'assigned', 'comment', 'review', 'pushed', 'merged',
    'closed', 'reopened', 'checkSuccess', 'checkFailure', 'checkWarning',
  ];
  const keys = new Set(NOTIFY_EVENT_DEFS.map((e) => e.key));
  for (const kind of kinds) assert.ok(keys.has(settingKeyOf(kind)), kind);
});

test('eventsFromTimeline: type을 이벤트 종류로 변환', () => {
  const cases = [
    ['comment', 'comment'],
    ['review', 'review'],
    ['code', 'review'],
    ['pull_push', 'pushed'],
    ['merge_pull', 'merged'],
    ['close', 'closed'],
    ['reopen', 'reopened'],
  ];
  for (const [type, kind] of cases) {
    const events = eventsFromTimeline([timelineItem({ id: 7, type })], ctx);
    assert.deepEqual(events, [
      { kind, key: 't:7', actor: 'alice', at: AFTER, url: `${PR_URL}#issuecomment-1` },
    ], type);
  }
});

test('eventsFromTimeline: html_url이 없으면 PR 주소를 사용', () => {
  const [ev] = eventsFromTimeline([timelineItem({ html_url: '' })], ctx);
  assert.equal(ev.url, PR_URL);
});

test('eventsFromTimeline: 내가 한 행동과 작성자가 없는 항목은 제외', () => {
  const events = eventsFromTimeline(
    [timelineItem({ id: 1, user: { login: 'me' } }), timelineItem({ id: 2, user: null }), timelineItem({ id: 3 })],
    ctx,
  );
  assert.deepEqual(events.map((e) => e.key), ['t:3']);
});

test('eventsFromTimeline: sinceMs 이전 항목은 제외하고 같은 시각은 포함', () => {
  const events = eventsFromTimeline(
    [
      timelineItem({ id: 1, created_at: BEFORE }),
      timelineItem({ id: 2, created_at: SINCE }),
      timelineItem({ id: 3, created_at: AFTER }),
    ],
    ctx,
  );
  assert.deepEqual(events.map((e) => e.key), ['t:2', 't:3']);
});

test('eventsFromTimeline: review_request와 assignees는 나를 지정했을 때만 반영', () => {
  const timeline = [
    timelineItem({ id: 1, type: 'review_request', assignee: { login: 'me' } }),
    timelineItem({ id: 2, type: 'review_request', assignee: { login: 'bob' } }),
    timelineItem({ id: 3, type: 'review_request', assignee: { login: 'me' }, removed_assignee: true }),
    timelineItem({ id: 4, type: 'review_request' }),
    timelineItem({ id: 5, type: 'assignees', assignee: { login: 'me' } }),
    timelineItem({ id: 6, type: 'assignees', assignee: { login: 'bob' } }),
    timelineItem({ id: 7, type: 'assignees', assignee: { login: 'me' }, removed_assignee: true }),
    timelineItem({ id: 8, type: 'assignees' }),
  ];
  const events = eventsFromTimeline(timeline, ctx);
  assert.deepEqual(events.map((e) => [e.key, e.kind]), [
    ['t:1', 'reviewRequested'],
    ['t:5', 'assigned'],
  ]);
});

test('eventsFromTimeline: 알 수 없는 type은 무시', () => {
  const events = eventsFromTimeline(
    [timelineItem({ id: 1, type: 'label' }), timelineItem({ id: 2, type: 'commit_ref' })],
    ctx,
  );
  assert.deepEqual(events, []);
});

const pull = (over) => ({
  user: { login: 'alice' },
  created_at: AFTER,
  html_url: PR_URL,
  ...over,
});
const pullCtx = { me: 'me', sinceMs: Date.parse(SINCE), prKey: 'acme/web#1' };

test('newPullEvent: 내가 연 PR은 제외', () => {
  assert.equal(newPullEvent(pull({ user: { login: 'me' } }), pullCtx), null);
});

test('newPullEvent: sinceMs 이전에 생성된 PR은 제외', () => {
  assert.equal(newPullEvent(pull({ created_at: BEFORE }), pullCtx), null);
});

test('newPullEvent: 그 외에는 new:<prKey> 키의 이벤트를 반환', () => {
  assert.deepEqual(newPullEvent(pull(), pullCtx), {
    kind: 'newPull',
    key: 'new:acme/web#1',
    actor: 'alice',
    at: AFTER,
    url: PR_URL,
  });
});

test('checkTransition: 진행 중이거나 상태가 없으면 알리지 않음', () => {
  assert.equal(checkTransition(undefined, { sha: 'a', state: 'pending' }), null);
  assert.equal(checkTransition({ sha: 'a', state: 'success' }, { sha: 'a', state: 'pending' }), null);
  assert.equal(checkTransition({ sha: 'a', state: 'success' }, { sha: 'b', state: null }), null);
  assert.equal(checkTransition(undefined, { sha: 'a', state: 'neutral' }), null);
});

test('checkTransition: 같은 커밋에서 같은 상태면 알리지 않음', () => {
  assert.equal(checkTransition({ sha: 'a', state: 'failure' }, { sha: 'a', state: 'failure' }), null);
});

test('checkTransition: 종료 상태로 바뀌면 해당 상태를 반환', () => {
  assert.equal(checkTransition({ sha: 'a', state: 'pending' }, { sha: 'a', state: 'failure' }), 'failure');
  assert.equal(checkTransition({ sha: 'a', state: 'failure' }, { sha: 'a', state: 'success' }), 'success');
  assert.equal(checkTransition({ sha: 'a', state: 'pending' }, { sha: 'a', state: 'warning' }), 'warning');
});

test('checkTransition: 새 커밋이면 같은 종료 상태여도 알림', () => {
  assert.equal(checkTransition({ sha: 'a', state: 'success' }, { sha: 'b', state: 'success' }), 'success');
});

test('checkTransition: 이전 기록이 없어도 종료 상태면 알림', () => {
  assert.equal(checkTransition(undefined, { sha: 'a', state: 'success' }), 'success');
});

const BASE_URL = 'https://git.example.com';
const makePr = (number, over) => ({
  key: `acme/web#${number}`,
  owner: 'acme',
  repo: 'web',
  number,
  title: `제목 ${number}`,
  url: `${BASE_URL}/acme/web/pulls/${number}`,
  ...over,
});
const makeEvent = (kind, actor, over) => ({
  kind,
  key: `k:${kind}:${actor}`,
  actor,
  at: AFTER,
  url: `${PR_URL}#${kind}-${actor}`,
  ...over,
});

test('buildNotifications: 우선순위가 가장 높은 종류가 제목 라벨이 된다', () => {
  const pr = makePr(1);
  const [spec] = buildNotifications(
    [{ pr, events: [makeEvent('comment', 'alice'), makeEvent('reviewRequested', 'bob')] }],
    { baseUrl: BASE_URL },
  );
  assert.equal(spec.title, '리뷰 요청 · acme/web #1');
  assert.equal(spec.message, '제목 1');
  assert.equal(spec.contextMessage, 'bob님이 나를 리뷰어로 지정했습니다, alice님이 코멘트를 남겼습니다');
  assert.equal(spec.url, pr.url);
});

test('buildNotifications: 같은 문구는 하나로 합치고 이벤트 주소로 연결', () => {
  const pr = makePr(1);
  const first = makeEvent('comment', 'alice', { key: 'a', url: `${PR_URL}#issuecomment-1` });
  const second = makeEvent('comment', 'alice', { key: 'b', url: `${PR_URL}#issuecomment-2` });
  const [spec] = buildNotifications([{ pr, events: [first, second] }], { baseUrl: BASE_URL });
  assert.equal(spec.contextMessage, 'alice님이 코멘트를 남겼습니다');
  assert.equal(spec.url, first.url);
});

test('buildNotifications: 문구가 하나인 그룹은 해당 이벤트 주소로 연결', () => {
  const pr = makePr(1);
  const event = makeEvent('comment', 'alice', { url: `${PR_URL}#issuecomment-9` });
  const [spec] = buildNotifications([{ pr, events: [event] }], { baseUrl: BASE_URL });
  assert.equal(spec.url, `${PR_URL}#issuecomment-9`);
  assert.equal(spec.title, '코멘트 · acme/web #1');
});

test('buildNotifications: 문구가 여러 개인 그룹은 PR 주소로 연결', () => {
  const pr = makePr(1);
  const [spec] = buildNotifications(
    [{ pr, events: [makeEvent('comment', 'alice'), makeEvent('comment', 'bob')] }],
    { baseUrl: BASE_URL },
  );
  assert.equal(spec.url, pr.url);
});

test('buildNotifications: 문구가 3개 이상이면 앞의 2개만 보이고 나머지는 건수로 표시', () => {
  const pr = makePr(1);
  const three = buildNotifications(
    [
      {
        pr,
        events: [makeEvent('comment', 'carol'), makeEvent('assigned', 'bob'), makeEvent('reviewRequested', 'alice')],
      },
    ],
    { baseUrl: BASE_URL },
  );
  assert.equal(
    three[0].contextMessage,
    'alice님이 나를 리뷰어로 지정했습니다, bob님이 나를 담당자로 지정했습니다 외 1건',
  );

  const four = buildNotifications(
    [
      {
        pr,
        events: [
          makeEvent('pushed', 'dave'),
          makeEvent('comment', 'carol'),
          makeEvent('assigned', 'bob'),
          makeEvent('reviewRequested', 'alice'),
        ],
      },
    ],
    { baseUrl: BASE_URL },
  );
  assert.match(four[0].contextMessage, / 외 2건$/);
});

test('buildNotifications: 체크 이벤트는 행위자 없이 문구를 만든다', () => {
  const pr = makePr(1);
  const [spec] = buildNotifications(
    [{ pr, events: [makeEvent('checkFailure', ''), makeEvent('checkSuccess', '')] }],
    { baseUrl: BASE_URL },
  );
  assert.equal(spec.title, '체크 실패 · acme/web #1');
  assert.equal(spec.contextMessage, 'CI 체크가 실패했습니다, CI 체크가 모두 성공했습니다');
});

test('buildNotifications: 그룹마다 알림을 하나씩 만든다', () => {
  const groups = [1, 2, 3, 4, 5].map((n) => ({ pr: makePr(n), events: [makeEvent('comment', 'alice')] }));
  const specs = buildNotifications(groups, { baseUrl: BASE_URL });
  assert.equal(specs.length, 5);
  assert.deepEqual(specs.map((s) => s.message), ['제목 1', '제목 2', '제목 3', '제목 4', '제목 5']);
});

test('buildNotifications: 그룹이 5개를 넘으면 요약 알림 하나로 합친다', () => {
  const kinds = ['comment', 'merged', 'pushed', 'review', 'assigned', 'newPull'];
  const groups = kinds.map((kind, i) => ({ pr: makePr(i + 1), events: [makeEvent(kind, 'alice')] }));
  const specs = buildNotifications(groups, { baseUrl: BASE_URL });
  assert.deepEqual(specs, [
    {
      url: `${BASE_URL}/notifications`,
      title: 'Gitea 새 소식 6건',
      message: '코멘트 · acme/web #1\n머지됨 · acme/web #2\n새 커밋 · acme/web #3',
      contextMessage: '알림을 누르면 Gitea 알림함이 열립니다',
    },
  ]);
});

test('notificationId / urlFromNotificationId: 해시가 포함된 주소도 그대로 복원', () => {
  const url = `${PR_URL}#issuecomment-1`;
  const id = notificationId(url, 2);
  assert.notEqual(id, url);
  assert.equal(urlFromNotificationId(id), url);
});

test('urlFromNotificationId: 표식이 없으면 빈 문자열', () => {
  assert.equal(urlFromNotificationId('plain-id'), '');
});
