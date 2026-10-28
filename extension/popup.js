import { loadSettings, originPattern } from './src/settings.js';
import { describeError } from './src/gitea.js';
import { orderedTabs, loadDashboard } from './src/dashboard.js';
import { renderTabs, renderList, renderSkeleton, formatRelative } from './src/render.js';
import { ICONS } from './src/icons.js';

const $ = (id) => document.getElementById(id);
const el = {
  updated: $('updated'),
  refresh: $('refresh'),
  openSettings: $('open-settings'),
  tabs: $('tabs'),
  banner: $('banner'),
  list: $('list'),
};

// ICONS는 정적 상수이므로 innerHTML로 넣어도 안전하다.
el.refresh.innerHTML = ICONS.sync;
el.openSettings.innerHTML = ICONS.gear;

const settings = await loadSettings();
window.gprApplyTheme(settings.theme);
localStorage.setItem('gpr-theme', settings.theme);

const tabs = orderedTabs(settings.tabOrder);
let activeKey = tabs[0].key; // 사용자가 정한 순서의 첫 탭으로 연다.
let data = null; // 현재 화면에 표시 중인 데이터(캐시 포함)
let loading = false;

function openSettings() {
  chrome.runtime.openOptionsPage();
  window.close();
}

el.openSettings.addEventListener('click', openSettings);

function showPanel(message) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-primary';
  button.textContent = '설정 열기';
  button.addEventListener('click', openSettings);

  const text = document.createElement('p');
  text.textContent = message;

  const panel = document.createElement('div');
  panel.className = 'state-panel';
  panel.append(text, button);

  el.tabs.hidden = true;
  el.refresh.disabled = true;
  el.list.replaceChildren(panel);
}

function showBanner(kind, message) {
  el.banner.dataset.kind = kind;
  el.banner.textContent = message;
  el.banner.hidden = false;
}

function hideBanner() {
  el.banner.hidden = true;
  el.banner.textContent = '';
  delete el.banner.dataset.kind;
}

function setUpdated() {
  if (loading) {
    el.updated.textContent = '업데이트 중…';
    el.updated.removeAttribute('title');
  } else if (data) {
    el.updated.textContent = `${formatRelative(data.fetchedAt)} 업데이트`;
    el.updated.title = new Date(data.fetchedAt).toLocaleString('ko-KR');
  } else {
    el.updated.textContent = '';
    el.updated.removeAttribute('title');
  }
}

function renderBody() {
  const counts = Object.fromEntries(tabs.map((t) => [t.key, data.tabs[t.key]?.length ?? 0]));
  const tab = tabs.find((t) => t.key === activeKey);
  const scrollTop = el.list.scrollTop;
  el.tabs.hidden = false;
  renderTabs(el.tabs, tabs, counts, activeKey, selectTab);
  renderList(el.list, data.tabs[activeKey] ?? [], settings.fields, { emptyText: tab.empty });
  el.list.scrollTop = scrollTop;
}

function selectTab(key) {
  if (key === activeKey || !data) return;
  activeKey = key;
  renderBody();
  el.list.scrollTop = 0;
}

async function refresh() {
  if (loading) return;
  loading = true;
  el.refresh.disabled = true;
  el.refresh.classList.add('spinning');
  setUpdated();
  hideBanner();
  try {
    const result = await loadDashboard(settings, {
      onSearched: (partial) => {
        // 이미 표시 중인 데이터가 있으면 리뷰어/체크가 잠시 사라지는 깜빡임을 피하기 위해 건너뛴다.
        if (data) return;
        data = partial;
        renderBody();
      },
    });
    data = result;
    renderBody();
    if (result.warning) showBanner('warning', result.warning);
    await chrome.storage.local.set({ cache: result }).catch((err) => console.warn('캐시 저장 실패', err));
  } catch (err) {
    const suffix = data ? ' 마지막으로 불러온 데이터를 표시합니다.' : '';
    showBanner('error', describeError(err) + suffix);
    if (!data) el.list.replaceChildren();
  } finally {
    loading = false;
    el.refresh.disabled = false;
    el.refresh.classList.remove('spinning');
    setUpdated();
  }
}

async function start() {
  if (!settings.baseUrl || !settings.token) {
    showPanel('Gitea 주소와 토큰을 설정하세요.');
    return;
  }
  const granted = await chrome.permissions.contains({ origins: [originPattern(settings.baseUrl)] });
  if (!granted) {
    showPanel('Gitea 주소 접근 권한이 없습니다. 설정에서 다시 저장해 권한을 허용하세요.');
    return;
  }

  const { cache } = await chrome.storage.local.get('cache');
  if (cache?.baseUrl === settings.baseUrl && cache.tabs) {
    data = cache;
    renderBody();
    setUpdated();
  } else {
    el.tabs.hidden = true;
    renderSkeleton(el.list);
  }

  el.refresh.addEventListener('click', refresh);
  refresh();
}

await start();
