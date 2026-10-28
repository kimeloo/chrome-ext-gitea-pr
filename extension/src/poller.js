// 알림 폴링 한 회분을 수행한다. Gitea 알림함과 내가 연 PR의 체크 상태를 확인하여 브라우저 알림을 만든다.
// 상태(notifyState)는 chrome.storage.local에 보관하며, 확인에 실패하면 알리지 않고 다음 주기에 다시 시도한다.

import { mapLimit } from './dashboard.js';
import { GiteaClient } from './gitea.js';
import {
  buildNotifications,
  checkTransition,
  eventsFromTimeline,
  newPullEvent,
  notificationId,
  settingKeyOf,
} from './notify.js';
import { loadSettings, originPattern } from './settings.js';
import { summarizeChecks } from './summarize.js';

const CONCURRENCY = 4;
const MINUTE_MS = 60 * 1000;
// 커서가 밀리거나 일부 실패한 경우에도 놓치지 않도록 이벤트 조회 범위를 넓게 잡는다. 중복은 seen으로 걸러낸다.
const EVENT_WINDOW_MS = 10 * MINUTE_MS;
const THREAD_MARGIN_MS = 2 * MINUTE_MS;
// 같은 스레드가 계속 실패해도 커서가 무한히 멈춰 있지 않도록 재시도 범위를 제한한다.
const MAX_RETRY_WINDOW_MS = 60 * MINUTE_MS;
const SEEN_LIMIT = 500;

const TIMELINE_SETTING_KEYS = ['reviewRequested', 'assigned', 'comment', 'review', 'pushed', 'merged', 'closedReopened'];

let inFlight = null;

// 동시에 여러 번 호출되어도 진행 중인 확인 하나를 공유한다. 실패는 로그만 남기고 던지지 않는다.
export function runPoll() {
  inFlight ??= poll()
    .catch((err) => console.warn('[Gitea PR Status] 알림 확인 실패', err))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

const prKeyOf = (owner, repo, number) => `${owner}/${repo}#${number}`;

// 내가 연 열린 PR의 체크 상태를 조회한다. 실패한 항목은 이전 기록을 유지한다.
async function collectChecks(client, prevMap, { detectTransitions }) {
  const map = {};
  const entries = [];
  let failed = false;

  let mine;
  try {
    mine = await client.searchPulls('created');
  } catch (err) {
    console.warn('[Gitea PR Status] 내 PR 목록 조회 실패', err);
    return { map: prevMap, entries, failed: true };
  }

  await mapLimit(mine, CONCURRENCY, async (issue) => {
    const owner = issue.repository.owner;
    const repo = issue.repository.name;
    const prKey = prKeyOf(owner, repo, issue.number);
    try {
      const pull = await client.getPull(owner, repo, issue.number);
      const sha = pull.head?.sha;
      const state = summarizeChecks(await client.getCombinedStatus(owner, repo, sha))?.state ?? null;
      map[prKey] = { sha, state };
      if (!detectTransitions) return;
      const transition = checkTransition(prevMap[prKey], { sha, state });
      if (!transition) return;
      entries.push({
        pr: { key: prKey, owner, repo, number: issue.number, title: issue.title, url: issue.html_url },
        event: {
          kind: `check${transition[0].toUpperCase()}${transition.slice(1)}`,
          key: `chk:${prKey}:${sha}:${transition}`,
          actor: '',
          at: new Date().toISOString(),
          url: issue.html_url,
        },
      });
    } catch (err) {
      failed = true;
      console.warn(`[Gitea PR Status] 체크 상태 조회 실패: ${prKey}`, err);
      if (prevMap[prKey]) map[prKey] = prevMap[prKey];
    }
  });

  return { map, entries, failed };
}

// 알림함 스레드 하나에서 이벤트를 모은다. 켜진 항목에 필요한 API만 호출한다.
async function collectThreadEvents(client, thread, { me, sinceMs, sinceIso, needTimeline, needPull }) {
  const owner = thread.repository.owner.login;
  const repo = thread.repository.name;
  const number = Number(thread.subject.url.split('/').pop());
  const pr = {
    key: prKeyOf(owner, repo, number),
    owner,
    repo,
    number,
    title: thread.subject.title,
    url: thread.subject.html_url,
  };

  const events = [];
  if (needTimeline) {
    const timeline = await client.listTimeline(owner, repo, number, sinceIso);
    events.push(...eventsFromTimeline(timeline, { me, sinceMs, prUrl: pr.url }));
  }
  if (needPull) {
    const created = newPullEvent(await client.getPull(owner, repo, number), { me, sinceMs, prKey: pr.key });
    if (created) events.push(created);
  }
  return { pr, events };
}

async function poll() {
  const settings = await loadSettings();
  const { baseUrl, token, notify } = settings;
  if (!notify.enabled || !baseUrl || !token) return;
  if (!(await chrome.permissions.contains({ origins: [originPattern(baseUrl)] }))) return;

  const client = new GiteaClient(baseUrl, token);
  const { notifyState: state } = await chrome.storage.local.get('notifyState');

  // 기준선: 지금까지의 상태는 알리지 않고, 이후 변경분부터 알린다.
  if (!state || state.baseUrl !== baseUrl) {
    const me = (await client.getCurrentUser()).login;
    const serverNow = await client.getServerTime();
    const checksResult = notify.events.checks ? await collectChecks(client, {}, { detectTransitions: false }) : null;
    await chrome.storage.local.set({
      notifyState: {
        baseUrl,
        me,
        floorMs: serverNow,
        cursorMs: serverNow,
        seen: [],
        checks: checksResult?.map ?? {},
        // 체크 상태 기준선이 온전히 기록된 경우에만 다음 확인부터 상태 변화를 알린다.
        checksReady: Boolean(checksResult && !checksResult.failed),
      },
    });
    return;
  }

  const { me } = state;
  const sinceMs = Math.max(state.floorMs, state.cursorMs - EVENT_WINDOW_MS);
  const sinceIso = new Date(sinceMs).toISOString();
  // 알림함 조회에 실패하면 상태를 건드리지 않고 이번 확인을 끝낸다.
  const { threads, serverTime } = await client.listPullNotifications(
    new Date(state.cursorMs - THREAD_MARGIN_MS).toISOString(),
  );

  let failed = false;
  const candidates = []; // { pr, event }

  const needTimeline = TIMELINE_SETTING_KEYS.some((key) => notify.events[key]);
  const needPull = Boolean(notify.events.newPull);
  if (needTimeline || needPull) {
    await mapLimit(threads, CONCURRENCY, async (thread) => {
      try {
        const context = { me, sinceMs, sinceIso, needTimeline, needPull };
        const { pr, events } = await collectThreadEvents(client, thread, context);
        for (const event of events) candidates.push({ pr, event });
      } catch (err) {
        failed = true;
        console.warn('[Gitea PR Status] 알림 스레드 조회 실패', err);
      }
    });
  }

  // 체크 상태 기준선이 없으면(기준선 조회 실패, 항목을 새로 켬) 이번에는 기록만 하고 알리지 않는다.
  let checks = state.checks ?? {};
  let checksReady = false;
  if (notify.events.checks) {
    const detectTransitions = Boolean(state.checksReady);
    const result = await collectChecks(client, detectTransitions ? checks : {}, { detectTransitions });
    checks = result.map;
    checksReady = detectTransitions || !result.failed;
    if (detectTransitions) failed ||= result.failed;
    for (const { pr, event } of result.entries) candidates.push({ pr, event });
  }

  // 켜진 항목이면서 아직 알리지 않은 이벤트만 PR별로 묶는다.
  const seen = new Set(state.seen);
  const emittedKeys = [];
  const groups = new Map();
  for (const { pr, event } of candidates) {
    if (!notify.events[settingKeyOf(event.kind)] || seen.has(event.key)) continue;
    seen.add(event.key);
    emittedKeys.push(event.key);
    if (!groups.has(pr.key)) groups.set(pr.key, { pr, events: [] });
    groups.get(pr.key).events.push(event);
  }

  const specs = buildNotifications([...groups.values()], { baseUrl });
  for (const [i, spec] of specs.entries()) {
    try {
      await chrome.notifications.create(notificationId(spec.url, i), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: spec.title,
        message: spec.message,
        contextMessage: spec.contextMessage,
        priority: 0,
      });
    } catch (err) {
      console.warn('[Gitea PR Status] 알림 표시 실패', err);
    }
  }

  await chrome.storage.local.set({
    notifyState: {
      baseUrl,
      me,
      floorMs: state.floorMs,
      // 일부 조회가 실패했으면 커서를 유지하여 다음 주기에 같은 범위를 다시 확인한다(최대 1시간).
      cursorMs: failed && serverTime - state.cursorMs < MAX_RETRY_WINDOW_MS ? state.cursorMs : serverTime,
      seen: [...state.seen, ...emittedKeys].slice(-SEEN_LIMIT),
      checks,
      checksReady,
    },
  });
}
