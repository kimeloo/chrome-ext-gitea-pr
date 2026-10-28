// 가짜 Chrome 창의 UI를 담당한다: 탭, 주소 표시줄, 확장 팝업, 권한 요청, 알림 토스트, 숨은 백그라운드 프레임.
// chrome.* 동작은 알지 못하며, 호스트(host.js)가 이 모듈의 메서드를 호출한다.

import { FAKE_EXTENSION_ID } from './common.js';
import { createHowto } from './howto.js';

const START_URL = 'chrome://newtab/';
const OPTIONS_URL = `chrome-extension://${FAKE_EXTENSION_ID}/options.html`;
const OPTIONS_TITLE = 'Gitea PR Status 설정';

// Chrome 팝업의 크기 제한이다.
const POPUP_MIN = 25;
const POPUP_MAX_WIDTH = 800;
const POPUP_MAX_HEIGHT = 600;
// 크기 보고가 오지 않는 경우에도 팝업이 보이도록 하는 지연 시간이다.
const POPUP_REVEAL_FALLBACK_MS = 600;

const TOAST_MS = 8000;
const TOAST_HOVER_MS = 3000;
const TOAST_MAX = 5;

const CLOSE_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
const GLOBE_SVG =
  '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3.2 3 3.2 15 0 18M12 3c-3.2 3-3.2 15 0 18"/></svg>';

const svgUri = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
const GLOBE_ICON = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="#80868b" stroke-width="1.6" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3.2 3 3.2 15 0 18M12 3c-3.2 3-3.2 15 0 18"/></svg>',
);
const PAGE_ICON = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="#80868b" stroke-width="1.6" d="M6 3h8l4 4v14H6zM14 3v4h4"/></svg>',
);

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// 탭 제목은 URL의 호스트와 경로로 만든다.
function titleOfUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

// `https://host/*` 같은 호스트 권한 패턴에서 호스트만 꺼낸다.
function hostOfOrigin(pattern) {
  const match = /^[a-z*]+:\/\/([^/]+)/i.exec(pattern);
  return match ? match[1] : pattern;
}

export function createBrowser({ assets, onFrameRemoved }) {
  const byId = (id) => document.getElementById(id);
  const el = {
    browser: byId('browser'),
    tabList: byId('tab-list'),
    toolbar: byId('toolbar'),
    omnibox: byId('omnibox'),
    omniUrl: byId('omnibox-url'),
    extAction: byId('ext-action'),
    content: byId('content'),
    toasts: byId('toasts'),
    bgHost: byId('bg-host'),
  };
  const manifestName = assets.manifest.name;

  el.extAction.title = manifestName;
  el.extAction.setAttribute('aria-label', manifestName);
  el.extAction.querySelector('img').src = assets.icons['32'];

  // ---- 탭 ----

  const tabs = []; // { id, kind, title, url, tabEl, titleEl, pane, frame? }
  let nextTabId = 1;
  let activeId = 0;

  function renderTitle(tab) {
    tab.titleEl.textContent = tab.title;
    tab.tabEl.title = tab.title;
  }

  function activateTab(id) {
    activeId = id;
    let current = null;
    for (const tab of tabs) {
      const active = tab.id === id;
      if (active) current = tab;
      tab.tabEl.classList.toggle('active', active);
      tab.tabEl.setAttribute('aria-selected', String(active));
      tab.pane.hidden = !active;
    }
    el.omniUrl.textContent = current ? current.url : '';
  }

  function addTab({ kind, title, url, favicon, pane }) {
    const id = nextTabId;
    nextTabId += 1;

    const tabEl = h('div', 'tab');
    tabEl.dataset.tabId = String(id);
    tabEl.setAttribute('role', 'tab');
    const icon = h('img', 'tab-favicon');
    icon.alt = '';
    icon.src = favicon;
    const titleEl = h('span', 'tab-title');
    const closeEl = h('button', 'tab-close');
    closeEl.type = 'button';
    closeEl.setAttribute('aria-label', '탭 닫기');
    closeEl.innerHTML = CLOSE_SVG;
    tabEl.append(icon, titleEl, closeEl);

    const tab = { id, kind, title, url, tabEl, titleEl, pane, frame: null };
    tabEl.addEventListener('click', () => activateTab(id));
    tabEl.addEventListener('auxclick', (e) => {
      if (e.button === 1) closeTab(id);
    });
    closeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(id);
    });

    pane.hidden = true;
    tabs.push(tab);
    el.tabList.append(tabEl);
    el.content.append(pane);
    renderTitle(tab);
    activateTab(id);
    return tab;
  }

  function closeTab(id) {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const [tab] = tabs.splice(index, 1);
    if (tab.frame) onFrameRemoved(tab.frame.contentWindow);
    tab.tabEl.remove();
    tab.pane.remove();
    if (tabs.length === 0) {
      openStartTab();
    } else if (activeId === id) {
      activateTab(tabs[Math.min(index, tabs.length - 1)].id);
    }
  }

  function openStartTab() {
    const pane = h('div', 'pane start-pane');
    const card = h('div', 'start-card');

    const brand = h('div', 'start-brand');
    const logo = h('img');
    logo.alt = '';
    logo.src = assets.icons['128'];
    brand.append(logo, h('h1', undefined, `${manifestName} 미리보기`));

    card.append(
      brand,
      h('p', undefined, '확장 프로그램을 설치하지 않고 팝업·설정·알림을 직접 사용해 볼 수 있습니다.'),
      createHowto(),
      h(
        'p',
        'start-note',
        '툴바 오른쪽 위의 확장 아이콘을 눌러 팝업을 열 수 있습니다. 오른쪽 시뮬레이터에서 서버 상태와 PR 이벤트를 바꿔 보세요.',
      ),
    );
    pane.append(card);
    return addTab({ kind: 'start', title: '새 탭', url: START_URL, favicon: PAGE_ICON, pane });
  }

  function openOptionsTab() {
    const existing = tabs.find((tab) => tab.kind === 'options');
    if (existing) {
      activateTab(existing.id);
      return existing.frame;
    }

    const pane = h('div', 'pane options-pane');
    const frame = h('iframe', 'frame');
    frame.dataset.frame = 'options';
    frame.title = OPTIONS_TITLE;
    pane.append(frame);

    const tab = addTab({ kind: 'options', title: OPTIONS_TITLE, url: OPTIONS_URL, favicon: assets.icons['16'], pane });
    tab.frame = frame;
    frame.addEventListener('load', () => {
      const title = frame.contentDocument ? frame.contentDocument.title : '';
      if (!title) return;
      tab.title = title;
      renderTitle(tab);
    });
    frame.srcdoc = assets.frames.options;
    return frame;
  }

  function openLinkTab(url) {
    const pane = h('div', 'pane page-placeholder');
    pane.dataset.url = url;
    const icon = h('div', 'placeholder-icon');
    icon.innerHTML = GLOBE_SVG;
    pane.append(
      icon,
      h('div', 'placeholder-url', url),
      h('div', 'placeholder-note', '미리보기에서는 실제 페이지를 열지 않습니다.'),
    );
    addTab({ kind: 'link', title: titleOfUrl(url), url, favicon: GLOBE_ICON, pane });
  }

  function getOptionsDocument() {
    const tab = tabs.find((t) => t.kind === 'options');
    return tab && tab.frame ? tab.frame.contentDocument : null;
  }

  // ---- 확장 팝업 ----

  let popup = null; // { container, frame, timer }

  function placePopup() {
    if (!popup) return;
    const win = el.browser.getBoundingClientRect();
    const toolbar = el.toolbar.getBoundingClientRect();
    const action = el.extAction.getBoundingClientRect();
    const width = popup.container.offsetWidth;
    const left = clamp(action.right - win.left - width, 8, Math.max(8, win.width - width - 8));
    popup.container.style.top = `${Math.round(toolbar.bottom - win.top + 2)}px`;
    popup.container.style.left = `${Math.round(left)}px`;
  }

  function revealPopup() {
    if (popup) popup.container.classList.add('ready');
  }

  function openPopup() {
    if (popup) return;
    const container = h('div');
    container.id = 'popup';
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-label', manifestName);
    const frame = h('iframe');
    frame.id = 'popup-frame';
    frame.dataset.frame = 'popup';
    frame.title = `${manifestName} 팝업`;
    container.append(frame);
    el.browser.append(container);

    popup = { container, frame, timer: setTimeout(revealPopup, POPUP_REVEAL_FALLBACK_MS) };
    el.extAction.setAttribute('aria-expanded', 'true');
    placePopup();
    frame.srcdoc = assets.frames.popup;
  }

  function closePopup() {
    if (!popup) return;
    const { container, frame, timer } = popup;
    popup = null;
    clearTimeout(timer);
    onFrameRemoved(frame.contentWindow);
    container.remove();
    el.extAction.setAttribute('aria-expanded', 'false');
  }

  // 내용이 최대 높이를 넘으면 세로 스크롤바가 생기므로, 가로 스크롤바가 생기지 않도록 그 너비만큼 넓힌다.
  let scrollbarWidthCache = -1;

  function scrollbarWidth() {
    if (scrollbarWidthCache < 0) {
      const probe = h('div');
      probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll';
      document.body.append(probe);
      scrollbarWidthCache = probe.offsetWidth - probe.clientWidth;
      probe.remove();
    }
    return scrollbarWidthCache;
  }

  function resizePopup(width, height) {
    if (!popup) return;
    const extra = height > POPUP_MAX_HEIGHT ? scrollbarWidth() : 0;
    popup.frame.style.width = `${clamp(width + extra, POPUP_MIN, POPUP_MAX_WIDTH)}px`;
    popup.frame.style.height = `${clamp(height, POPUP_MIN, POPUP_MAX_HEIGHT)}px`;
    placePopup();
    revealPopup();
  }

  function togglePopup() {
    if (popup) closePopup();
    else openPopup();
  }

  el.extAction.addEventListener('click', togglePopup);

  // 팝업 바깥(셸) 어디든 누르면 닫는다. 확장 아이콘은 click에서 토글하므로 제외한다.
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!popup) return;
      if (popup.container.contains(e.target) || el.extAction.contains(e.target)) return;
      closePopup();
    },
    true,
  );

  // 포커스가 같은 문서의 iframe으로 옮겨 간 경우에는 창이 포커스를 유지하므로 닫지 않는다.
  window.addEventListener('blur', () => {
    if (!popup) return;
    setTimeout(() => {
      if (popup && !document.hasFocus()) closePopup();
    }, 50);
  });

  // ---- 권한 요청 ----

  const promptQueue = []; // { origins, resolve }
  let prompt = null; // { root, resolve }

  function placePrompt() {
    if (!prompt) return;
    const win = el.browser.getBoundingClientRect();
    const toolbar = el.toolbar.getBoundingClientRect();
    const omnibox = el.omnibox.getBoundingClientRect();
    prompt.root.style.top = `${Math.round(toolbar.bottom - win.top + 4)}px`;
    prompt.root.style.left = `${Math.round(Math.max(8, omnibox.left - win.left))}px`;
  }

  function resolvePrompt(allowed) {
    if (!prompt) return;
    const current = prompt;
    prompt = null;
    current.root.remove();
    current.resolve(allowed);
    showNextPrompt();
  }

  function showNextPrompt() {
    const next = promptQueue.shift();
    if (!next) return;

    const root = h('div');
    root.id = 'perm-prompt';
    root.setAttribute('role', 'alertdialog');
    root.setAttribute('aria-labelledby', 'perm-title');
    root.dataset.origins = next.origins.join(' ');

    const head = h('div', 'perm-head');
    const icon = h('img');
    icon.alt = '';
    icon.src = assets.icons['32'];
    const title = h('h2', 'perm-title', '사이트 액세스 요청');
    title.id = 'perm-title';
    head.append(icon, title);

    const hosts = h('ul', 'perm-hosts');
    for (const origin of next.origins) hosts.append(h('li', undefined, hostOfOrigin(origin)));

    const deny = h('button', 'perm-btn', '거부');
    deny.type = 'button';
    deny.id = 'perm-deny';
    const allow = h('button', 'perm-btn primary', '허용');
    allow.type = 'button';
    allow.id = 'perm-allow';
    const actions = h('div', 'perm-actions');
    actions.append(deny, allow);

    root.append(
      head,
      h('p', 'perm-body', `${manifestName} 확장 프로그램이 다음 사이트의 데이터를 읽고 변경하려고 합니다.`),
      hosts,
      actions,
    );
    deny.addEventListener('click', () => resolvePrompt(false));
    allow.addEventListener('click', () => resolvePrompt(true));

    el.browser.append(root);
    prompt = { root, resolve: next.resolve };
    placePrompt();
    allow.focus();
  }

  function requestPermission(origins) {
    return new Promise((resolve) => {
      promptQueue.push({ origins, resolve });
      if (!prompt) showNextPrompt();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (prompt) resolvePrompt(false);
    else closePopup();
  });

  new ResizeObserver(() => {
    placePopup();
    placePrompt();
  }).observe(el.browser);

  // ---- 알림 토스트 ----

  const activeToasts = new Map(); // id -> { root, timer, dismiss }

  function iconOfToast(spec) {
    return /^(data:|https?:|blob:)/.test(spec.iconUrl) ? spec.iconUrl : assets.icons['128'];
  }

  // 호스트가 직접 지우는 경우(clear)에는 onClose를 부르지 않는다.
  function removeToast(id) {
    const entry = activeToasts.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    activeToasts.delete(id);
    entry.root.remove();
    return true;
  }

  function showToast(spec, { onClick, onClose } = {}) {
    removeToast(spec.id);

    const root = h('div', 'toast');
    root.dataset.notificationId = spec.id;

    const appIcon = h('span', 'toast-app-icon');
    appIcon.setAttribute('aria-hidden', 'true');
    const close = h('button', 'toast-close');
    close.type = 'button';
    close.setAttribute('aria-label', '알림 닫기');
    close.innerHTML = CLOSE_SVG;
    const app = h('div', 'toast-app');
    app.append(appIcon, h('span', 'toast-app-name', `Google Chrome · ${manifestName}`), close);

    const icon = h('img', 'toast-icon');
    icon.alt = '';
    icon.src = iconOfToast(spec);
    const text = h('div', 'toast-text');
    text.append(
      h('div', 'toast-title', spec.title),
      h('div', 'toast-message', spec.message),
      h('div', 'toast-context', spec.contextMessage),
    );
    const body = h('div', 'toast-body');
    body.append(icon, text);
    root.append(app, body);

    const entry = { root, timer: 0, dismiss: null };
    entry.dismiss = () => {
      if (activeToasts.get(spec.id) !== entry) return;
      removeToast(spec.id);
      if (onClose) onClose();
    };
    entry.timer = setTimeout(entry.dismiss, TOAST_MS);

    root.addEventListener('pointerenter', () => clearTimeout(entry.timer));
    root.addEventListener('pointerleave', () => {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(entry.dismiss, TOAST_HOVER_MS);
    });
    root.addEventListener('click', (e) => {
      if (!e.target.closest('.toast-close') && onClick) onClick();
      entry.dismiss();
    });

    activeToasts.set(spec.id, entry);
    el.toasts.append(root);
    while (activeToasts.size > TOAST_MAX) activeToasts.values().next().value.dismiss();
  }

  // ---- 프레임 ----

  let background = null;

  function createBackgroundFrame() {
    const frame = h('iframe');
    frame.dataset.frame = 'background';
    frame.title = `${manifestName} 서비스 워커`;
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    el.bgHost.append(frame);
    frame.srcdoc = assets.frames.background;
    background = frame;
    return frame;
  }

  // 페이지를 다시 불러오기 전에 호출한다. iframe을 먼저 제거해 설정 페이지의 beforeunload 확인창을 피한다.
  function teardownFrames() {
    closePopup();
    for (const tab of tabs) {
      if (!tab.frame) continue;
      onFrameRemoved(tab.frame.contentWindow);
      tab.frame.remove();
      tab.frame = null;
    }
    if (background) {
      onFrameRemoved(background.contentWindow);
      background.remove();
      background = null;
    }
  }

  openStartTab();

  return {
    openOptionsTab,
    openLinkTab,
    getOptionsDocument,
    togglePopup,
    closePopup,
    resizePopup,
    requestPermission,
    showToast,
    removeToast,
    createBackgroundFrame,
    teardownFrames,
  };
}
