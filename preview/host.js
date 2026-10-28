// chrome.* 에뮬레이션의 호스트 쪽 구현이다. 프레임(background/options/popup)은 frame-shim.js를 통해 이 객체를 호출한다.
// 프레임과 주고받는 값은 모두 JSON 문자열로 직렬화하여, 프레임 realm에서 다시 만들어지도록 한다.

import { KEYS, FAKE_EXTENSION_ID, POLL_ALARM, readJson, writeJson } from './common.js';

const NOTIFICATION_LOG_LIMIT = 50;
const FRAME_KINDS = ['background', 'options', 'popup'];

// 헤더 이름을 `Authorization` 같은 표준 표기로도 접근할 수 있도록 복제한다.
function withCanonicalCase(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    out[name] = value;
    out[name.replace(/(^|-)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())] = value;
  }
  return out;
}

function originsOf(permissions) {
  return Array.isArray(permissions?.origins) ? permissions.origins.map(String) : [];
}

export function createHost({ mock, assets, ui }) {
  const frames = new Map(); // frameId -> { id, kind, win, ready, listeners: [{ name, fn }] }
  const readyWaiters = []; // { kind, done }
  const subscribers = new Set();
  let nextFrameId = 1;
  let notificationSeq = 0;

  const store = readJson(KEYS.storage, {});
  const granted = new Set(readJson(KEYS.permissions, []));
  const alarms = new Map(); // name -> { name, scheduledTime, periodInMinutes, timer }
  const activeNotifications = new Map(); // id -> entry
  const notificationLog = [];

  function emit(event) {
    for (const fn of [...subscribers]) {
      try {
        fn(event);
      } catch (err) {
        console.error('[미리보기] 구독자 오류', err);
      }
    }
  }

  // 리스너 인자는 JSON 문자열로 전달하고, 프레임이 제공한 래퍼가 자기 realm에서 파싱한다.
  function dispatch(name, args) {
    const payload = JSON.stringify(args);
    for (const frame of [...frames.values()]) {
      for (const entry of [...frame.listeners]) {
        if (entry.name !== name) continue;
        try {
          entry.fn(payload);
        } catch (err) {
          console.error(`[미리보기] ${name} 리스너 오류`, err);
        }
      }
    }
  }

  // ---- storage ----

  function storageGet(keys) {
    if (keys === null || keys === undefined) return { ...store };
    const out = {};
    if (typeof keys === 'string' || Array.isArray(keys)) {
      for (const key of [].concat(keys)) {
        if (Object.hasOwn(store, key)) out[key] = store[key];
      }
    } else if (typeof keys === 'object') {
      for (const [key, fallback] of Object.entries(keys)) {
        out[key] = Object.hasOwn(store, key) ? store[key] : fallback;
      }
    }
    return out;
  }

  function commitStorage(changes) {
    if (Object.keys(changes).length === 0) return;
    writeJson(KEYS.storage, store);
    setTimeout(() => dispatch('storage.onChanged', [changes, 'local']), 0);
  }

  function storageSet(items) {
    const changes = {};
    for (const [key, value] of Object.entries(items ?? {})) {
      const had = Object.hasOwn(store, key);
      if (had && JSON.stringify(store[key]) === JSON.stringify(value)) continue;
      changes[key] = had ? { oldValue: store[key], newValue: value } : { newValue: value };
      store[key] = value;
    }
    commitStorage(changes);
  }

  function storageRemove(keys) {
    const changes = {};
    for (const key of [].concat(keys ?? [])) {
      if (!Object.hasOwn(store, key)) continue;
      changes[key] = { oldValue: store[key] };
      delete store[key];
    }
    commitStorage(changes);
  }

  // ---- permissions ----

  function savePermissions() {
    writeJson(KEYS.permissions, [...granted]);
  }

  function permissionsContains(permissions) {
    return originsOf(permissions).every((origin) => granted.has(origin));
  }

  async function permissionsRequest(permissions) {
    const missing = originsOf(permissions).filter((origin) => !granted.has(origin));
    if (missing.length === 0) return true;
    const allowed = await ui.requestPermission(missing);
    if (allowed) {
      for (const origin of missing) granted.add(origin);
      savePermissions();
    }
    return allowed;
  }

  function permissionsRemove(permissions) {
    let removed = false;
    for (const origin of originsOf(permissions)) removed = granted.delete(origin) || removed;
    if (removed) savePermissions();
    return removed;
  }

  // ---- alarms ----

  function describeAlarm(alarm) {
    const info = { name: alarm.name, scheduledTime: alarm.scheduledTime };
    if (alarm.periodInMinutes) info.periodInMinutes = alarm.periodInMinutes;
    return info;
  }

  function armAlarm(alarm) {
    clearTimeout(alarm.timer);
    alarm.timer = setTimeout(() => fireAlarm(alarm), Math.max(0, alarm.scheduledTime - Date.now()));
  }

  function fireAlarm(alarm) {
    if (alarms.get(alarm.name) !== alarm) return;
    const info = describeAlarm(alarm);
    if (alarm.periodInMinutes) {
      const period = alarm.periodInMinutes * 60000;
      do {
        alarm.scheduledTime += period;
      } while (alarm.scheduledTime <= Date.now());
      armAlarm(alarm);
    } else {
      alarms.delete(alarm.name);
    }
    emit({ type: 'alarms' });
    dispatch('alarms.onAlarm', [info]);
  }

  function alarmsCreate(name, info) {
    // 이름을 생략한 호출(create(info))은 빈 이름의 알람으로 취급한다.
    if (name !== null && typeof name === 'object') {
      info = name;
      name = '';
    }
    const spec = info ?? {};
    const period = Number(spec.periodInMinutes) > 0 ? Number(spec.periodInMinutes) : undefined;
    let when;
    if (typeof spec.when === 'number') when = spec.when;
    else if (typeof spec.delayInMinutes === 'number') when = Date.now() + spec.delayInMinutes * 60000;
    else if (period) when = Date.now() + period * 60000;
    else when = Date.now();

    const key = String(name ?? '');
    const previous = alarms.get(key);
    if (previous) clearTimeout(previous.timer);
    const alarm = { name: key, scheduledTime: when, periodInMinutes: period, timer: 0 };
    alarms.set(key, alarm);
    armAlarm(alarm);
    emit({ type: 'alarms' });
  }

  function alarmsGet(name) {
    const alarm = alarms.get(String(name ?? ''));
    return alarm ? describeAlarm(alarm) : undefined;
  }

  function alarmsClear(name) {
    const alarm = alarms.get(String(name ?? ''));
    if (!alarm) return false;
    clearTimeout(alarm.timer);
    alarms.delete(alarm.name);
    emit({ type: 'alarms' });
    return true;
  }

  // ---- notifications ----

  function notificationsCreate(id, options) {
    if (id !== null && typeof id === 'object') {
      options = id;
      id = undefined;
    }
    const notificationId = id ? String(id) : `gpr-preview-notification-${(notificationSeq += 1)}`;
    const opts = options ?? {};
    const entry = {
      id: notificationId,
      title: String(opts.title ?? ''),
      message: String(opts.message ?? ''),
      contextMessage: String(opts.contextMessage ?? ''),
      iconUrl: String(opts.iconUrl ?? ''),
      createdAt: Date.now(),
    };

    // 같은 ID로 다시 만들면 기존 토스트를 교체한다.
    ui.removeToast(notificationId);
    activeNotifications.set(notificationId, entry);
    ui.showToast(entry, {
      onClick: () => dispatch('notifications.onClicked', [notificationId]),
      onClose: () => activeNotifications.delete(notificationId),
    });

    notificationLog.unshift(entry);
    if (notificationLog.length > NOTIFICATION_LOG_LIMIT) notificationLog.length = NOTIFICATION_LOG_LIMIT;
    emit({ type: 'notification', entry });
    return notificationId;
  }

  function notificationsClear(id) {
    const had = activeNotifications.delete(String(id));
    ui.removeToast(String(id));
    return had;
  }

  // ---- runtime / tabs ----

  function getURL(path) {
    const clean = String(path ?? '').replace(/^\/+/, '');
    const match = /^icons\/icon(\d+)\.png$/.exec(clean);
    if (match && assets.icons[match[1]]) return assets.icons[match[1]];
    return `chrome-extension://${FAKE_EXTENSION_ID}/${clean}`;
  }

  function tabsCreate(properties) {
    const url = String(properties?.url ?? '');
    ui.openLinkTab(url);
    return { url, active: true };
  }

  // ---- 프레임 레지스트리 ----

  const api = {
    'storage.get': (keys) => storageGet(keys),
    'storage.set': (items) => storageSet(items),
    'storage.remove': (keys) => storageRemove(keys),
    'permissions.contains': (permissions) => permissionsContains(permissions),
    'permissions.request': (permissions) => permissionsRequest(permissions),
    'permissions.remove': (permissions) => permissionsRemove(permissions),
    'alarms.create': (name, info) => alarmsCreate(name, info),
    'alarms.get': (name) => alarmsGet(name),
    'alarms.clear': (name) => alarmsClear(name),
    'alarms.getAll': () => [...alarms.values()].map(describeAlarm),
    'notifications.create': (id, options) => notificationsCreate(id, options),
    'notifications.clear': (id) => notificationsClear(id),
    'notifications.getAll': () => Object.fromEntries([...activeNotifications.keys()].map((id) => [id, true])),
    'runtime.openOptionsPage': () => {
      ui.openOptionsTab();
    },
    'tabs.create': (properties) => tabsCreate(properties),
  };

  function resolveWaiters(kind, value) {
    for (const waiter of readyWaiters.filter((w) => w.kind === kind)) waiter.done(value);
  }

  function waitFrameReady(kind, timeoutMs = 8000) {
    for (const frame of frames.values()) {
      if (frame.kind === kind && frame.ready) return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const waiter = {
        kind,
        done: (value) => {
          clearTimeout(timer);
          const index = readyWaiters.indexOf(waiter);
          if (index >= 0) readyWaiters.splice(index, 1);
          resolve(value);
        },
      };
      const timer = setTimeout(() => waiter.done(false), timeoutMs);
      readyWaiters.push(waiter);
    });
  }

  const host = {
    extensionId: FAKE_EXTENSION_ID,

    // ---- 프레임에서 호출하는 메서드 ----

    registerFrame(kind, win) {
      if (!FRAME_KINDS.includes(kind)) throw new Error(`알 수 없는 프레임 종류: ${kind}`);
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, { id, kind, win, ready: false, listeners: [] });
      return id;
    },

    frameReady(id) {
      const frame = frames.get(id);
      if (!frame) return;
      frame.ready = true;
      resolveWaiters(frame.kind, true);
    },

    // 제거된 프레임의 호출은 응답하지 않아, 닫힌 팝업의 늦은 작업이 저장소를 바꾸지 못하게 한다.
    async call(id, method, json) {
      if (!frames.has(id)) return new Promise(() => {});
      const handler = api[method];
      if (!handler) throw new Error(`지원하지 않는 API: ${method}`);
      const result = await handler(...(json ? JSON.parse(json) : []));
      return result === undefined ? undefined : JSON.stringify(result);
    },

    addListener(id, name, fn) {
      frames.get(id)?.listeners.push({ name, fn });
    },

    removeListener(id, name, fn) {
      const frame = frames.get(id);
      if (!frame) return;
      frame.listeners = frame.listeners.filter((entry) => !(entry.name === name && entry.fn === fn));
    },

    fetch(id, url, json) {
      const { method = 'GET', headers = {} } = json ? JSON.parse(json) : {};
      return mock.handle(String(url), { method, headers: withCanonicalCase(headers) });
    },

    getURL,

    popupClose(id) {
      if (frames.get(id)?.kind === 'popup') ui.closePopup();
    },

    popupSize(id, width, height) {
      if (frames.get(id)?.kind === 'popup') ui.resizePopup(width, height);
    },

    framePointerDown(id) {
      const frame = frames.get(id);
      if (frame && frame.kind !== 'popup') ui.closePopup();
    },

    openLink(id, url) {
      const frame = frames.get(id);
      if (!frame) return;
      ui.openLinkTab(String(url));
      // 팝업에서 링크를 열면 포커스가 새 탭으로 옮겨져 팝업이 닫힌다.
      if (frame.kind === 'popup') ui.closePopup();
    },

    // ---- 셸에서 호출하는 메서드 ----

    dropFrame(win) {
      for (const [id, frame] of frames) {
        if (frame.win === win) frames.delete(id);
      }
    },

    waitFrameReady,

    // 첫 실행이면 설치, 이후에는 브라우저 시작으로 취급한다.
    async boot() {
      ui.createBackgroundFrame();
      const ready = await waitFrameReady('background');
      if (!ready) console.warn('[미리보기] 백그라운드 프레임이 준비되지 않았습니다.');
      if (localStorage.getItem(KEYS.installed) === null) {
        localStorage.setItem(KEYS.installed, '1');
        dispatch('runtime.onInstalled', [{ reason: 'install' }]);
      } else {
        dispatch('runtime.onStartup', []);
      }
    },

    // 알람 일정은 그대로 두고 onAlarm만 즉시 발생시킨다.
    pollNow() {
      const alarm = alarms.get(POLL_ALARM);
      if (!alarm) return false;
      dispatch('alarms.onAlarm', [describeAlarm(alarm)]);
      return true;
    },

    getAlarm: (name) => alarmsGet(name),

    getNotificationLog: () => [...notificationLog],

    clickNotification(id) {
      dispatch('notifications.onClicked', [String(id)]);
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };

  return host;
}
