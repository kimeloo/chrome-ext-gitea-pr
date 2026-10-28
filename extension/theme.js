// 첫 페인트 전에 동기 실행되어야 하므로 모듈이 아닌 classic script로 둔다.
(() => {
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const PREFS = ['system', 'light', 'dark'];

  window.gprApplyTheme = (pref) => {
    const normalized = PREFS.includes(pref) ? pref : 'system';
    const resolved = normalized === 'system' ? (media.matches ? 'dark' : 'light') : normalized;
    root.dataset.theme = resolved;
    root.dataset.themePref = normalized;
    root.style.colorScheme = resolved;
  };

  // localStorage['gpr-theme']는 chrome.storage.local 설정값의 동기 미러이다.
  let stored = null;
  try {
    stored = localStorage.getItem('gpr-theme');
  } catch {
    // 저장소 접근이 막힌 환경에서는 시스템 설정을 따른다.
  }
  window.gprApplyTheme(stored || 'system');

  media.addEventListener('change', () => {
    if (root.dataset.themePref === 'system') window.gprApplyTheme('system');
  });
})();
