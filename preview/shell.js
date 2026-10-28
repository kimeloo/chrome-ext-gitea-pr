// 미리보기 진입점: 가짜 Gitea, 가짜 Chrome 창, chrome.* 호스트, 시뮬레이터를 연결하고 부팅한다.

import { createMockGitea } from './mock-gitea.js';
import { KEYS, readJson, writeJson } from './common.js';
import { createBrowser } from './browser.js';
import { createHost } from './host.js';
import { createSimulator } from './simulator.js';

const assets = JSON.parse(document.getElementById('gpr-assets').textContent);

const mock = createMockGitea({
  load: () => readJson(KEYS.gitea, null),
  save: (state) => writeJson(KEYS.gitea, state),
});

// 프레임이 제거될 때 호스트가 리스너를 정리해야 하므로, 호스트 생성 전에 콜백만 연결해 둔다.
let host;
const browser = createBrowser({ assets, onFrameRemoved: (win) => host.dropFrame(win) });
host = createHost({ mock, assets, ui: browser });

// 프레임의 frame-shim.js가 parent.__gprHost를 사용하므로 어떤 프레임보다 먼저 노출한다.
window.__gprHost = host;

createSimulator({ mock, host, browser });

await host.boot();
