import {
  FIELD_DEFS,
  FIELD_GROUPS,
  NOTIFY_EVENT_DEFS,
  NOTIFY_INTERVALS,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  normalizeBaseUrl,
  originPattern,
} from './src/settings.js';
import { ApiError, GiteaClient, describeError } from './src/gitea.js';
import { renderTabs, renderList } from './src/render.js';
import { ICONS } from './src/icons.js';
import { SAMPLE_PRS, sampleCounts } from './src/preview-data.js';
import { orderedTabs } from './src/dashboard.js';
import { createTabOrderList } from './src/tab-order.js';
import { initSideNav } from './src/side-nav.js';

const $ = (id) => document.getElementById(id);
const el = {
  baseUrl: $('base-url'),
  token: $('token'),
  tokenToggle: $('token-toggle'),
  connStatus: $('conn-status'),
  fieldGroups: $('field-groups'),
  notifyMaster: $('notify-master'),
  notifyOptions: $('notify-options'),
  notifyInterval: $('notify-interval'),
  notifyEvents: $('notify-events'),
  tabOrder: $('tab-order'),
  preview: $('preview'),
  previewTabs: $('preview-tabs'),
  previewList: $('preview-list'),
  dirty: $('dirty'),
  status: $('status'),
  reset: $('reset'),
  save: $('save'),
};
const themeRadios = [...document.querySelectorAll('input[name="theme"]')];
const fieldInputs = new Map(); // 항목 key -> 체크박스
const notifyEventInputs = new Map(); // 알림 이벤트 key -> 체크박스
let notifyEnabled; // 알림 마스터 스위치 체크박스
let tabOrderList; // 팝업 탭 순서 목록

const NOTIFY_MASTER = {
  key: 'enabled',
  label: '브라우저 알림 받기',
  hint: '켜면 아래 주기마다 Gitea 서버에 새 소식을 확인합니다. 확인에 실패하면 알리지 않고 다음 주기에 다시 시도합니다.',
};

const STATUS_MS = 2500;

let savedSnapshot = '';
let saving = false;
let statusTimer = 0;
let connSeq = 0;

function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// 토글 스위치: 실제 체크박스를 스위치 위에 투명하게 겹쳐 키보드와 포커스 동작을 그대로 사용한다.
// kind는 접근성 id 접두어이고, register는 체크박스에 식별용 속성을 붙이고 목록에 등록한다.
function buildToggle(def, kind, register) {
  const labelId = `${kind}-label-${def.key}`;
  const hintId = `${kind}-hint-${def.key}`;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('aria-labelledby', labelId);
  if (def.hint) input.setAttribute('aria-describedby', hintId);
  register(input);

  const label = create('span', 'toggle-label', def.label);
  label.id = labelId;
  const text = create('span', 'toggle-text');
  text.append(label);
  if (def.term) text.append(create('span', 'toggle-term', def.term));
  if (def.hint) {
    const hint = create('span', 'toggle-hint', def.hint);
    hint.id = hintId;
    text.append(hint);
  }

  const track = create('span', 'track');
  track.setAttribute('aria-hidden', 'true');
  const sw = create('span', 'switch');
  sw.append(input, track);

  const row = create('label', 'toggle');
  row.append(text, sw);
  return row;
}

function buildFieldToggle(def) {
  return buildToggle(def, 'field', (input) => {
    input.dataset.field = def.key;
    fieldInputs.set(def.key, input);
  });
}

function buildFieldToggles() {
  for (const group of FIELD_GROUPS) {
    const titleId = `group-${group.key}`;
    const title = create('h3', 'group-title', group.label);
    title.id = titleId;

    const section = create('div', 'group');
    section.setAttribute('role', 'group');
    section.setAttribute('aria-labelledby', titleId);
    section.append(title, ...FIELD_DEFS.filter((f) => f.group === group.key).map(buildFieldToggle));
    el.fieldGroups.append(section);
  }
}

function buildNotifyToggles() {
  el.notifyMaster.append(
    buildToggle(NOTIFY_MASTER, 'notify', (input) => {
      input.id = 'notify-enabled';
      notifyEnabled = input;
    }),
  );

  for (const minutes of NOTIFY_INTERVALS) {
    const option = create('option', '', `${minutes}분마다`);
    option.value = String(minutes);
    el.notifyInterval.append(option);
  }

  el.notifyEvents.append(
    ...NOTIFY_EVENT_DEFS.map((def) =>
      buildToggle(def, 'notify-event', (input) => {
        input.dataset.notifyEvent = def.key;
        notifyEventInputs.set(def.key, input);
      }),
    ),
  );
}

// 알림 마스터 스위치가 꺼지면 하위 옵션 전체를 비활성화한다.
function syncNotifyOptions() {
  el.notifyOptions.disabled = !notifyEnabled.checked;
}

function setTheme(theme) {
  for (const radio of themeRadios) radio.checked = radio.value === theme;
}

function setNotify(notify) {
  notifyEnabled.checked = Boolean(notify.enabled);
  el.notifyInterval.value = String(notify.intervalMinutes);
  for (const [key, input] of notifyEventInputs) input.checked = Boolean(notify.events[key]);
  syncNotifyOptions();
}

function setForm(s) {
  el.baseUrl.value = s.baseUrl;
  el.token.value = s.token;
  setTheme(s.theme);
  for (const [key, input] of fieldInputs) input.checked = Boolean(s.fields[key]);
  tabOrderList.setOrder(s.tabOrder);
  setNotify(s.notify);
}

function readForm() {
  return {
    baseUrlInput: el.baseUrl.value.trim(),
    token: el.token.value.trim(),
    theme: themeRadios.find((r) => r.checked)?.value ?? DEFAULT_SETTINGS.theme,
    fields: Object.fromEntries(FIELD_DEFS.map((f) => [f.key, fieldInputs.get(f.key).checked])),
    tabOrder: tabOrderList.getOrder(),
    notify: {
      enabled: notifyEnabled.checked,
      intervalMinutes: Number(el.notifyInterval.value),
      events: Object.fromEntries(NOTIFY_EVENT_DEFS.map((e) => [e.key, notifyEventInputs.get(e.key).checked])),
    },
  };
}

function isDirty() {
  return JSON.stringify(readForm()) !== savedSnapshot;
}

function updateDirty() {
  const dirty = isDirty();
  el.dirty.hidden = !dirty;
  el.save.disabled = saving || !dirty;
}

function showStatus(text, kind = 'info') {
  clearTimeout(statusTimer);
  el.status.textContent = text;
  el.status.dataset.kind = kind;
  statusTimer = setTimeout(() => {
    el.status.textContent = '';
    delete el.status.dataset.kind;
  }, STATUS_MS);
}

function setConn(kind, text) {
  el.connStatus.dataset.kind = kind;
  el.connStatus.textContent = text;
  el.connStatus.hidden = false;
}

// 미리보기는 샘플 데이터이므로 링크와 버튼이 동작하거나 포커스를 받지 않도록 한다.
function neutralizePreview() {
  for (const node of el.preview.querySelectorAll('a, button')) node.tabIndex = -1;
}

function renderPreview() {
  const order = tabOrderList.getOrder();
  renderTabs(el.previewTabs, orderedTabs(order), sampleCounts, order[0], () => {});
  renderList(el.previewList, SAMPLE_PRS, readForm().fields, { emptyText: '' });
  neutralizePreview();
}

async function checkConnection(s) {
  const seq = ++connSeq;
  if (!s.baseUrl) return setConn('info', 'Gitea 주소를 입력하세요.');
  if (!s.token) return setConn('info', '토큰을 입력하세요.');

  setConn('info', '연결 확인 중…');
  let message;
  try {
    const granted = await chrome.permissions.contains({ origins: [originPattern(s.baseUrl)] });
    if (!granted) {
      message = ['error', 'Gitea 주소 접근 권한이 없습니다. 저장을 눌러 권한을 허용하세요.'];
    } else {
      const client = new GiteaClient(s.baseUrl, s.token);
      const user = await client.getCurrentUser();
      message = ['ok', `✓ ${user.login} 계정으로 연결되었습니다.`];
      if (s.notify.enabled) {
        // 알림 API는 별도의 notification 읽기 권한이 필요하다. 권한 외의 오류는 연결 결과에 반영하지 않는다.
        try {
          await client.getServerTime();
        } catch (err) {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            message = ['error', `✓ ${user.login} 계정으로 연결되었습니다. 단, 알림을 받으려면 토큰에 notification 읽기 권한이 필요합니다.`];
          }
        }
      }
    }
  } catch (err) {
    message = ['error', describeError(err)];
  }
  // 더 최근에 시작된 확인이 있으면 이전 결과는 버린다.
  if (seq === connSeq) setConn(...message);
}

// chrome.permissions.request는 사용자 제스처 안에서 호출해야 하므로 클릭 핸들러의 첫 await이어야 한다.
async function onSave() {
  if (saving) return;

  const draft = readForm();
  let baseUrl;
  try {
    baseUrl = normalizeBaseUrl(draft.baseUrlInput);
  } catch {
    showStatus('Gitea 주소 형식이 올바르지 않습니다.', 'error');
    return;
  }

  saving = true;
  el.save.disabled = true;
  let next;
  try {
    if (baseUrl) {
      let granted;
      try {
        granted = await chrome.permissions.request({ origins: [originPattern(baseUrl)] });
      } catch (err) {
        showStatus(`권한 요청 실패: ${err.message}`, 'error');
        return;
      }
      if (!granted) {
        showStatus('사이트 접근 권한이 거부되어 저장하지 않았습니다.', 'error');
        return;
      }
    }

    const prev = await loadSettings();
    next = { baseUrl, token: draft.token, theme: draft.theme, fields: draft.fields, tabOrder: draft.tabOrder, notify: draft.notify };
    await saveSettings(next);

    if (prev.baseUrl !== next.baseUrl || prev.token !== next.token) {
      await chrome.storage.local.remove('cache');
    }
    if (prev.baseUrl && originPattern(prev.baseUrl) !== (next.baseUrl ? originPattern(next.baseUrl) : '')) {
      chrome.permissions.remove({ origins: [originPattern(prev.baseUrl)] }).catch(() => {});
    }

    // 권한 확인이나 저장 중에 입력이 바뀌었다면 사용자의 입력을 덮어쓰지 않는다.
    if (el.baseUrl.value.trim() === draft.baseUrlInput) el.baseUrl.value = baseUrl;
    savedSnapshot = JSON.stringify({ ...draft, baseUrlInput: baseUrl });
    showStatus('저장했습니다.', 'ok');
  } catch (err) {
    showStatus(`저장하지 못했습니다: ${err.message}`, 'error');
    return;
  } finally {
    saving = false;
    updateDirty();
  }

  await checkConnection(next);
}

function onReset() {
  setTheme(DEFAULT_SETTINGS.theme);
  for (const [key, input] of fieldInputs) input.checked = DEFAULT_SETTINGS.fields[key];
  setNotify(DEFAULT_SETTINGS.notify);
  tabOrderList.setOrder(DEFAULT_SETTINGS.tabOrder);
  window.gprApplyTheme(DEFAULT_SETTINGS.theme);
  renderPreview();
  updateDirty();
  showStatus('기본값을 채웠습니다. 저장을 눌러 적용하세요.');
}

function onTabOrderChange() {
  renderPreview();
  updateDirty();
}

function onInput(e) {
  const target = e.target;
  if (target.name === 'theme') window.gprApplyTheme(readForm().theme);
  if (target === notifyEnabled) syncNotifyOptions();
  if (target.dataset?.field) renderPreview();
  updateDirty();
}

function onToggleToken() {
  const reveal = el.token.type === 'password';
  el.token.type = reveal ? 'text' : 'password';
  el.tokenToggle.setAttribute('aria-pressed', String(reveal));
}

async function init() {
  // ICONS는 정적 상수이므로 innerHTML로 넣어도 안전하다.
  el.tokenToggle.innerHTML = ICONS.eye;
  $('preview-sync').innerHTML = ICONS.sync;
  $('preview-gear').innerHTML = ICONS.gear;

  buildFieldToggles();
  buildNotifyToggles();
  tabOrderList = createTabOrderList(el.tabOrder, { order: DEFAULT_SETTINGS.tabOrder, onChange: onTabOrderChange });

  const saved = await loadSettings();
  setForm(saved);
  window.gprApplyTheme(saved.theme);
  renderPreview();
  savedSnapshot = JSON.stringify(readForm());
  updateDirty();

  initSideNav($('side-nav'));
  document.addEventListener('input', onInput);
  el.tokenToggle.addEventListener('click', onToggleToken);
  el.reset.addEventListener('click', onReset);
  el.save.addEventListener('click', onSave);
  el.preview.addEventListener('click', (e) => {
    if (e.target.closest('a')) e.preventDefault();
  });
  window.addEventListener('beforeunload', (e) => {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  if (saved.baseUrl || saved.token) checkConnection(saved);
}

await init();
