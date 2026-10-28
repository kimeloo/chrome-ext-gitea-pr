// 확장 프레임(background/options/popup)에서 가장 먼저 실행되는 classic script이다.
// 확장이 사용하는 chrome.* 만 에뮬레이션하며, 실제 처리는 parent.__gprHost에 위임한다.
// 호스트에서 넘어오는 값은 JSON 문자열이므로 프레임 realm에서 다시 파싱하여 instanceof 검사가 어긋나지 않게 한다.
(() => {
  'use strict';

  const kind = window.__GPR_FRAME__;
  const host = window.parent && window.parent.__gprHost;
  if (!kind || !host) return;

  const frameId = host.registerFrame(kind, window);

  const toError = (e) => new Error(String((e && e.message) || e));
  const toTypeError = (e) => new TypeError(String((e && e.message) || e));

  function call(method, ...args) {
    return new Promise((resolve, reject) => {
      let pending;
      try {
        pending = host.call(frameId, method, JSON.stringify(args));
      } catch (e) {
        reject(toError(e));
        return;
      }
      pending.then(
        (json) => resolve(json === undefined ? undefined : JSON.parse(json)),
        (e) => reject(toError(e)),
      );
    });
  }

  function createEvent(name) {
    const wrappers = new Map();
    return {
      addListener(fn) {
        if (typeof fn !== 'function' || wrappers.has(fn)) return;
        const wrapper = (json) => fn(...JSON.parse(json));
        wrappers.set(fn, wrapper);
        host.addListener(frameId, name, wrapper);
      },
      removeListener(fn) {
        const wrapper = wrappers.get(fn);
        if (!wrapper) return;
        wrappers.delete(fn);
        host.removeListener(frameId, name, wrapper);
      },
      hasListener: (fn) => wrappers.has(fn),
      hasListeners: () => wrappers.size > 0,
    };
  }

  const chromeApi = {
    runtime: {
      id: host.extensionId,
      OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' },
      onInstalled: createEvent('runtime.onInstalled'),
      onStartup: createEvent('runtime.onStartup'),
      getURL: (path) => host.getURL(String(path === undefined ? '' : path)),
      openOptionsPage: () => call('runtime.openOptionsPage'),
    },
    storage: {
      local: {
        get: (keys) => call('storage.get', keys === undefined ? null : keys),
        set: (items) => call('storage.set', items),
        remove: (keys) => call('storage.remove', keys),
      },
      onChanged: createEvent('storage.onChanged'),
    },
    permissions: {
      contains: (permissions) => call('permissions.contains', permissions),
      request: (permissions) => call('permissions.request', permissions),
      remove: (permissions) => call('permissions.remove', permissions),
    },
    alarms: {
      create: (name, info) => call('alarms.create', name, info),
      get: (name) => call('alarms.get', name),
      clear: (name) => call('alarms.clear', name),
      getAll: () => call('alarms.getAll'),
      onAlarm: createEvent('alarms.onAlarm'),
    },
    notifications: {
      create: (id, options) => call('notifications.create', id, options),
      clear: (id) => call('notifications.clear', id),
      getAll: () => call('notifications.getAll'),
      onClicked: createEvent('notifications.onClicked'),
    },
    tabs: {
      create: (properties) => call('tabs.create', properties),
    },
  };

  // 일반 페이지에도 window.chrome이 있으므로, 대입이 막힌 경우에만 속성을 다시 정의한다.
  try {
    window.chrome = chromeApi;
  } catch {
    // 아래에서 속성 정의로 다시 시도한다.
  }
  if (window.chrome !== chromeApi) {
    Object.defineProperty(window, 'chrome', { value: chromeApi, writable: true, enumerable: true });
  }

  // ---- fetch: Gitea API 요청은 가짜 서버로 보낸다 ----

  const nativeFetch = window.fetch.bind(window);

  function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return String(input);
  }

  function collectHeaders(input, init) {
    const source = (init && init.headers) || (input && typeof input === 'object' && input.headers) || {};
    const out = {};
    new Headers(source).forEach((value, name) => {
      out[name] = value;
    });
    return out;
  }

  window.fetch = function fetch(input, init) {
    const url = requestUrl(input);
    if (!url.includes('/api/v1/')) return nativeFetch(input, init);

    return new Promise((resolve, reject) => {
      const signal = init && init.signal;
      if (signal && signal.aborted) {
        reject(signal.reason);
        return;
      }

      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        reject(signal.reason);
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      const finish = () => {
        settled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
      };

      let pending;
      try {
        const method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
        pending = Promise.resolve(
          host.fetch(frameId, url, JSON.stringify({ method, headers: collectHeaders(input, init) })),
        );
      } catch (e) {
        finish();
        reject(toTypeError(e));
        return;
      }

      pending.then(
        (result) => {
          if (settled) return;
          finish();
          try {
            const status = result.status;
            const bodyless = status === 204 || status === 205 || status === 304;
            resolve(
              new Response(bodyless ? null : String(result.body), {
                status,
                headers: Object.assign({}, result.headers),
              }),
            );
          } catch (e) {
            reject(toTypeError(e));
          }
        },
        (e) => {
          if (settled) return;
          finish();
          reject(toTypeError(e));
        },
      );
    });
  };

  // ---- 모든 프레임 공통: 링크 가로채기와 포인터 보고 ----

  document.addEventListener('pointerdown', () => host.framePointerDown(frameId), true);

  function interceptBlankLink(e) {
    const target = e.target;
    const anchor = target && target.closest ? target.closest('a[target="_blank"]') : null;
    if (!anchor || !anchor.href) return;
    e.preventDefault();
    host.openLink(frameId, anchor.href);
  }

  document.addEventListener('click', interceptBlankLink, true);
  document.addEventListener(
    'auxclick',
    (e) => {
      if (e.button === 1) interceptBlankLink(e);
    },
    true,
  );

  // ---- 팝업 전용: 닫기와 크기 보고 ----

  function whenDomReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  if (kind === 'popup') {
    const close = () => host.popupClose(frameId);
    try {
      window.close = close;
    } catch {
      // 덮어쓸 수 없는 환경에서는 Escape와 호스트 쪽 닫기 규칙만 사용한다.
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });

    const report = () => {
      const body = document.body;
      if (!body) return;
      const rect = body.getBoundingClientRect();
      const style = getComputedStyle(body);
      const width = rect.width + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
      const height = rect.height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
      host.popupSize(frameId, Math.ceil(width), Math.ceil(height));
    };
    whenDomReady(() => {
      new ResizeObserver(report).observe(document.body);
      report();
    });
  }

  // 번들 마지막에서 호출되어, 모든 리스너가 등록된 뒤 모듈 평가가 끝났음을 알린다.
  window.__gprFrameReady = () => host.frameReady(frameId);
})();
