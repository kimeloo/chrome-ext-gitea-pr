// 설정 스키마와 저장소 접근을 담당한다. chrome/localStorage는 함수 내부에서만 참조한다.

import { TABS, normalizeTabOrder } from './dashboard.js';

export const FIELD_DEFS = [
  { key: 'owner', label: '소유자(조직)', term: 'Owner', group: 'repo', hint: '저장소를 소유한 조직 또는 사용자' },
  { key: 'repo', label: '저장소', term: 'Repository', group: 'repo', hint: '' },
  { key: 'baseBranch', label: '대상 브랜치', term: 'Base branch', group: 'repo', hint: '병합될 브랜치' },
  { key: 'headBranch', label: '소스 브랜치', term: 'Head branch', group: 'repo', hint: 'PR을 올린 브랜치' },
  { key: 'author', label: '작성자', term: 'Author', group: 'people', hint: '' },
  { key: 'reviewers', label: '리뷰어', term: 'Reviewers', group: 'people', hint: '' },
  { key: 'assignees', label: '담당자', term: 'Assignees', group: 'people', hint: '' },
  { key: 'participants', label: '참여자', term: 'Participants', group: 'people', hint: '작성자·댓글·리뷰를 남긴 사용자' },
  { key: 'reviewStatus', label: '리뷰 상태', term: 'Review status', group: 'status', hint: '승인 / 변경 요청 / 대기' },
  { key: 'checks', label: 'CI 상태', term: 'Commit status (Actions)', group: 'status', hint: 'Actions 등 커밋 상태 체크의 성공/실패' },
  { key: 'draft', label: '초안 표시', term: 'Draft', group: 'status', hint: '' },
  { key: 'mergeable', label: '병합 가능 여부', term: 'Mergeable', group: 'status', hint: '병합 가능 / 충돌' },
  { key: 'labels', label: '라벨', term: 'Labels', group: 'meta', hint: '' },
  { key: 'milestone', label: '마일스톤', term: 'Milestone', group: 'meta', hint: '' },
  { key: 'comments', label: '댓글 수', term: 'Comments', group: 'meta', hint: '대화 댓글 + 코드 리뷰 댓글' },
  { key: 'diffStat', label: '변경 규모', term: 'Changes', group: 'meta', hint: '+추가 / −삭제 줄, 변경 파일 수' },
  { key: 'createdAt', label: '생성일', term: 'Created', group: 'meta', hint: '' },
  { key: 'updatedAt', label: '최근 업데이트', term: 'Updated', group: 'meta', hint: '' },
  { key: 'dueDate', label: '마감일', term: 'Due date', group: 'meta', hint: '' },
];

export const FIELD_GROUPS = [
  { key: 'repo', label: '저장소·브랜치' },
  { key: 'people', label: '사람' },
  { key: 'status', label: '상태' },
  { key: 'meta', label: '메타데이터' },
];

export const NOTIFY_EVENT_DEFS = [
  { key: 'newPull', label: '새 PR', hint: 'watching 중인 저장소(내 저장소 포함)에 PR이 열렸을 때' },
  { key: 'reviewRequested', label: '리뷰어 지정', hint: '나를 리뷰어로 지정했을 때' },
  { key: 'assigned', label: '담당자 지정', hint: '나를 담당자로 지정했을 때' },
  { key: 'comment', label: '코멘트', hint: 'PR 대화에 코멘트가 달렸을 때' },
  { key: 'review', label: '리뷰 제출', hint: '승인 · 변경 요청 · 코드 리뷰 코멘트가 달렸을 때' },
  { key: 'pushed', label: '새 커밋 푸시', hint: 'PR에 새 커밋이 올라왔을 때' },
  { key: 'merged', label: '머지', hint: 'PR이 머지되었을 때' },
  { key: 'closedReopened', label: '닫힘 / 다시 열림', hint: 'PR이 머지 없이 닫히거나 다시 열렸을 때' },
  { key: 'checks', label: '체크 상태', hint: '내가 연 PR의 CI 체크가 성공 · 실패 · 경고로 바뀌었을 때' },
];

// 알림 확인 주기(분).
export const NOTIFY_INTERVALS = [1, 3, 5, 10, 15, 30, 60];

const DEFAULT_NOTIFY_INTERVAL = 5;

export const DEFAULT_SETTINGS = {
  baseUrl: '',
  token: '',
  theme: 'system',
  fields: Object.fromEntries(FIELD_DEFS.map((f) => [f.key, true])),
  tabOrder: TABS.map((t) => t.key),
  notify: {
    enabled: false,
    intervalMinutes: DEFAULT_NOTIFY_INTERVAL,
    events: Object.fromEntries(NOTIFY_EVENT_DEFS.map((e) => [e.key, true])),
  },
};

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  // 이후 버전에서 항목이 추가되어도 기본값이 채워지도록 중첩 fields와 notify까지 병합한다.
  const notify = {
    ...DEFAULT_SETTINGS.notify,
    ...settings?.notify,
    events: { ...DEFAULT_SETTINGS.notify.events, ...settings?.notify?.events },
  };
  if (!NOTIFY_INTERVALS.includes(notify.intervalMinutes)) notify.intervalMinutes = DEFAULT_NOTIFY_INTERVAL;
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    fields: { ...DEFAULT_SETTINGS.fields, ...settings?.fields },
    tabOrder: normalizeTabOrder(settings?.tabOrder),
    notify,
  };
}

export async function saveSettings(s) {
  await chrome.storage.local.set({ settings: s });
  // 첫 페인트 전에 동기적으로 읽을 수 있도록 테마만 localStorage에 미러링한다.
  localStorage.setItem('gpr-theme', s.theme);
}

export function normalizeBaseUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  // 스킴이 없을 때만 https를 붙인다. 다른 스킴(ftp 등)은 아래에서 거부한다.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error('invalid-url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('invalid-url');
  return (u.origin + u.pathname).replace(/\/+$/, '');
}

export function originPattern(baseUrl) {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.host}/*`;
}
