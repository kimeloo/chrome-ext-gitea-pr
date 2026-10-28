// 미리보기 셸 전반에서 공유하는 상수와 localStorage 보조 함수이다.

export const KEYS = {
  storage: 'gpr-preview:storage',
  permissions: 'gpr-preview:permissions',
  installed: 'gpr-preview:installed',
  gitea: 'gpr-preview:gitea',
  theme: 'gpr-theme',
};

const PREVIEW_KEY_PREFIX = 'gpr-preview:';

// 실제 확장 ID와 같은 형식(a-p 32자)의 가짜 값이다.
export const FAKE_EXTENSION_ID = 'hgfedcbaponmlkjihgfedcbaponmlkji';

export const POLL_ALARM = 'gpr-poll';

export function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[미리보기] 저장 실패', key, err);
  }
}

// 처음 설치한 상태로 되돌리기 위해 미리보기가 만든 키와 테마 미러를 모두 지운다.
export function clearPreviewStorage() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && (key.startsWith(PREVIEW_KEY_PREFIX) || key === KEYS.theme)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
}
