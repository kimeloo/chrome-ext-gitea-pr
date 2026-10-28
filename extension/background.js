// 서비스 워커: 설치 시 설정 페이지 열기, 알림 폴링 알람 관리, 알림 클릭 처리를 담당한다.
// 서비스 워커는 언제든 종료될 수 있으므로 모든 리스너를 최상위에서 동기적으로 등록한다.

import { NOTIFY_ALARM, urlFromNotificationId } from './src/notify.js';
import { runPoll } from './src/poller.js';
import { loadSettings } from './src/settings.js';

// 알림이 켜져 있고 연결 정보가 있을 때만 알람을 유지한다.
async function syncAlarm() {
  const { baseUrl, token, notify } = await loadSettings();
  if (!(notify.enabled && baseUrl && token)) {
    await chrome.alarms.clear(NOTIFY_ALARM);
    return;
  }
  const existing = await chrome.alarms.get(NOTIFY_ALARM);
  if (!existing || existing.periodInMinutes !== notify.intervalMinutes) {
    await chrome.alarms.create(NOTIFY_ALARM, {
      delayInMinutes: notify.intervalMinutes,
      periodInMinutes: notify.intervalMinutes,
    });
  }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) chrome.runtime.openOptionsPage();
  syncAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  syncAlarm();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const prev = changes.settings.oldValue;
  const next = changes.settings.newValue;

  const connectionChanged =
    (prev?.baseUrl ?? '') !== (next?.baseUrl ?? '') || (prev?.token ?? '') !== (next?.token ?? '');
  const notifyChanged = JSON.stringify(prev?.notify) !== JSON.stringify(next?.notify);
  if (!connectionChanged && !notifyChanged) return;

  // 연결 정보가 바뀌었거나 알림을 새로 켰다면 이전 상태를 버리고 기준선부터 다시 잡는다.
  const turnedOn = !prev?.notify?.enabled && Boolean(next?.notify?.enabled);
  if (connectionChanged || turnedOn) await chrome.storage.local.remove('notifyState');
  await syncAlarm();
  if (next?.notify?.enabled) runPoll();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === NOTIFY_ALARM) runPoll();
});

chrome.notifications.onClicked.addListener((id) => {
  const url = urlFromNotificationId(id);
  if (/^https?:\/\//.test(url)) chrome.tabs.create({ url });
  chrome.notifications.clear(id);
});
