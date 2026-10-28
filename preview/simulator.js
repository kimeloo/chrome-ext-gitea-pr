// 오른쪽 시뮬레이터 패널: 예시 값 입력, 서버 상태, 이벤트 만들기, 알림 주기, 알림 기록, 초기화를 연결한다.

import { POLL_ALARM, clearPreviewStorage } from './common.js';
import { createHowto } from './howto.js';

const EXAMPLE_VALUES = { 'base-url': 'https://gitea.example.com', token: 'preview-token' };
const STATE_LABELS = { open: '열림', closed: '닫힘', merged: '병합됨' };
const FILL_WAIT_MS = 8000;

// 목록 값은 배열 속성으로 제공되지만, 함수로 노출되어도 동작하도록 한다.
const resolveMember = (member) => (typeof member === 'function' ? member() : member);

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatClock(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString('ko-KR', { hour12: false });
}

// 입력 이벤트를 설정 페이지의 realm에서 만들어 보내야 해당 페이지의 리스너가 값을 읽는다.
function setInputValue(input, value) {
  input.value = value;
  input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true }));
}

export function createSimulator({ mock, host, browser }) {
  const byId = (id) => document.getElementById(id);
  const el = {
    toggle: byId('sim-toggle'),
    fill: byId('sim-fill'),
    fillNote: byId('sim-fill-note'),
    offline: byId('sim-offline'),
    slow: byId('sim-slow'),
    pr: byId('sim-pr'),
    actor: byId('sim-actor'),
    events: byId('sim-events'),
    result: byId('sim-result'),
    alarm: byId('sim-alarm'),
    pollNow: byId('sim-poll-now'),
    log: byId('sim-log'),
    reset: byId('sim-reset'),
  };
  const tokenRadios = [...document.querySelectorAll('input[name="sim-token"]')];

  byId('sim-howto').append(createHowto());

  // ---- 접기/펼치기 ----

  el.toggle.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('sim-collapsed');
    const label = collapsed ? '시뮬레이터 펼치기' : '시뮬레이터 접기';
    el.toggle.setAttribute('aria-expanded', String(!collapsed));
    el.toggle.setAttribute('aria-label', label);
    el.toggle.title = label;
  });

  // ---- 설정 예시 값 ----

  async function fillExample() {
    browser.openOptionsTab();
    const ready = await host.waitFrameReady('options', FILL_WAIT_MS);
    const doc = browser.getOptionsDocument();
    const baseUrl = doc && doc.getElementById('base-url');
    const token = doc && doc.getElementById('token');
    if (!ready || !baseUrl || !token) {
      el.fillNote.textContent = '설정 페이지가 아직 준비되지 않았습니다. 잠시 후 다시 눌러 주세요.';
      return;
    }
    setInputValue(baseUrl, EXAMPLE_VALUES['base-url']);
    setInputValue(token, EXAMPLE_VALUES.token);
    el.fillNote.textContent = '주소와 토큰을 입력했습니다. 설정 페이지에서 저장을 누르고 권한을 허용하세요.';
  }

  el.fill.addEventListener('click', fillExample);

  // ---- 서버 상태 ----

  function syncNetwork() {
    const network = mock.getNetwork();
    el.offline.checked = network.offline;
    el.slow.checked = network.slow;
    for (const radio of tokenRadios) radio.checked = radio.value === network.tokenMode;
  }

  el.offline.addEventListener('change', () => mock.setNetwork({ offline: el.offline.checked }));
  el.slow.addEventListener('change', () => mock.setNetwork({ slow: el.slow.checked }));
  for (const radio of tokenRadios) {
    radio.addEventListener('change', () => {
      if (radio.checked) mock.setNetwork({ tokenMode: radio.value });
    });
  }

  // ---- 이벤트 만들기 ----

  let pullSignature = '';

  // 목록이 그대로이면 다시 그리지 않아 열려 있는 선택 목록이 닫히지 않게 한다.
  function refreshPulls() {
    const pulls = mock.listPulls();
    const signature = JSON.stringify(pulls.map((pull) => [pull.key, pull.title, pull.state]));
    if (signature === pullSignature) return;
    pullSignature = signature;

    const previous = el.pr.value;
    el.pr.replaceChildren(
      ...pulls.map((pull) => {
        const option = h('option');
        option.value = pull.key;
        // 체크 상태 알림 대상(내가 연 PR)과 리뷰어 지정 불가 대상을 구분할 수 있도록 표시한다.
        const state = `${STATE_LABELS[pull.state] ?? pull.state}${pull.mine ? ' · 내 PR' : ''}`;
        option.textContent = `${pull.owner}/${pull.repo} #${pull.number} · ${pull.title} (${state})`;
        return option;
      }),
    );
    if (pulls.some((pull) => pull.key === previous)) {
      el.pr.value = previous;
    } else {
      const preferred = pulls.find((pull) => pull.state === 'open' && !pull.mine);
      if (preferred) el.pr.value = preferred.key;
    }
  }

  function renderActors() {
    el.actor.replaceChildren(
      ...resolveMember(mock.actors).map((actor) => {
        const option = h('option', undefined, actor);
        option.value = actor;
        return option;
      }),
    );
  }

  function renderEventButtons() {
    const groups = new Map();
    for (const { kind, label, group } of resolveMember(mock.eventKinds)) {
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ kind, label });
    }
    el.events.replaceChildren(
      ...[...groups].map(([group, kinds]) => {
        const section = h('div', 'sim-event-group');
        const grid = h('div', 'sim-event-grid');
        for (const { kind, label } of kinds) {
          const button = h('button', 'sim-btn', label);
          button.type = 'button';
          button.dataset.simEvent = kind;
          grid.append(button);
        }
        section.append(h('h4', undefined, group), grid);
        return section;
      }),
    );
  }

  function showResult(ok, message) {
    el.result.dataset.ok = String(ok);
    el.result.textContent = message;
  }

  el.events.addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-sim-event]');
    if (!button) return;
    try {
      const result = await mock.trigger(button.dataset.simEvent, { prKey: el.pr.value, actor: el.actor.value });
      showResult(Boolean(result.ok), result.message);
    } catch (err) {
      showResult(false, `이벤트를 만들지 못했습니다: ${err.message}`);
    }
  });

  // ---- 알림 주기 ----

  function updateAlarm() {
    const alarm = host.getAlarm(POLL_ALARM);
    el.pollNow.disabled = !alarm;
    if (!alarm) {
      el.alarm.textContent = '알림 꺼짐';
      return;
    }
    const clock = formatClock(Math.max(0, Math.ceil((alarm.scheduledTime - Date.now()) / 1000)));
    el.alarm.textContent = alarm.periodInMinutes
      ? `다음 확인까지 ${clock} · ${Number(alarm.periodInMinutes.toFixed(1))}분 주기`
      : `다음 확인까지 ${clock}`;
  }

  el.pollNow.addEventListener('click', () => {
    host.pollNow();
  });

  // ---- 알림 기록 ----

  function renderLog() {
    el.log.replaceChildren(
      ...host.getNotificationLog().map((entry) => {
        const item = h('button', 'sim-log-item');
        item.type = 'button';
        item.dataset.notificationId = entry.id;
        item.append(
          h('span', 'sim-log-time', formatTime(entry.createdAt)),
          h('span', 'sim-log-title', entry.title),
          h('span', 'sim-log-message', entry.message),
          h('span', 'sim-log-context', entry.contextMessage),
        );
        item.addEventListener('click', () => host.clickNotification(entry.id));
        return item;
      }),
    );
  }

  // ---- 초기화 ----

  el.reset.addEventListener('click', () => {
    if (!window.confirm('저장된 설정과 예시 데이터를 모두 지우고 처음 설치한 상태로 되돌릴까요?')) return;
    // 프레임을 먼저 제거해야 다시 불러오는 동안 저장소에 값이 다시 쓰이지 않는다.
    browser.teardownFrames();
    clearPreviewStorage();
    location.reload();
  });

  // ---- 초기 표시와 구독 ----

  renderActors();
  renderEventButtons();
  refreshPulls();
  syncNetwork();
  updateAlarm();
  renderLog();

  mock.subscribe(() => {
    refreshPulls();
    syncNetwork();
  });
  host.subscribe((event) => {
    if (event.type === 'alarms') updateAlarm();
    else if (event.type === 'notification') renderLog();
  });
  setInterval(updateAlarm, 1000);

  return { fillExample };
}
