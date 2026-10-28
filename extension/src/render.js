import { countReviewStates } from './summarize.js';
import { ICONS } from './icons.js';

const SAFE_URL = /^https?:\/\//i;
const LABEL_COLOR = /^#?[0-9a-f]{6}$/i;
const STACK_LIMIT = 5;
const RELATIVE = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });

const REVIEW_TEXT = {
  approved: '승인',
  changes_requested: '변경 요청',
  pending: '리뷰 대기',
  commented: '코멘트',
};
const REVIEW_ICON = { approved: 'check', changes_requested: 'x', pending: 'dotFill', commented: 'comment' };
const REVIEW_SUMMARY = [
  ['approved', '승인'],
  ['changes_requested', '변경 요청'],
  ['pending', '대기'],
  ['commented', '코멘트'],
];
const CHECK_ICON = { success: 'check', failure: 'x', warning: 'alert', pending: 'dotFill', neutral: 'dotFill' };

// API 문자열은 항상 텍스트 노드와 속성으로만 넣는다. innerHTML은 icons.js 상수에만 사용한다.
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      el.setAttribute(name, value === true ? '' : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child);
  }
  return el;
}

function icon(name) {
  const el = h('span', { class: 'icon' });
  el.innerHTML = ICONS[name];
  return el;
}

function toMillis(value) {
  if (value == null || value === '') return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function formatRelative(value, now = Date.now()) {
  const time = toMillis(value);
  if (time === null) return '';
  const diff = time - now;
  const sign = diff < 0 ? -1 : 1;
  const seconds = Math.abs(diff) / 1000;
  if (seconds < 60) return '방금 전';
  const minutes = seconds / 60;
  if (minutes < 60) return RELATIVE.format(sign * Math.floor(minutes), 'minute');
  const hours = minutes / 60;
  if (hours < 24) return RELATIVE.format(sign * Math.floor(hours), 'hour');
  const days = hours / 24;
  if (days < 30) return RELATIVE.format(sign * Math.floor(days), 'day');
  const months = days / 30.44;
  if (months < 12) return RELATIVE.format(sign * Math.max(1, Math.floor(months)), 'month');
  return RELATIVE.format(sign * Math.floor(days / 365.25), 'year');
}

function timeChip(className, prefix, value, now) {
  const time = toMillis(value);
  if (time === null) return null;
  return h(
    'span',
    { class: className, title: new Date(time).toLocaleString('ko-KR') },
    `${prefix} ${formatRelative(time, now)}`,
  );
}

function dueChip(value, now) {
  const time = toMillis(value);
  if (time === null) return null;
  const date = new Date(time);
  return h(
    'span',
    {
      class: time < now ? 'due overdue' : 'due',
      title: `마감일: ${date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    },
    icon('calendar'),
    `~ ${date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}`,
  );
}

function hueOf(login) {
  let hue = 0;
  for (const ch of login) hue = (hue * 31 + ch.codePointAt(0)) % 360;
  return hue;
}

function fallbackAvatar(login) {
  const el = h('span', { class: 'avatar fallback', 'aria-hidden': 'true' }, (Array.from(login)[0] ?? '?').toUpperCase());
  el.style.setProperty('--avatar-hue', String(hueOf(login)));
  return el;
}

function avatar(user) {
  const login = user?.login ?? '';
  const src = user?.avatarUrl ?? '';
  if (!SAFE_URL.test(src)) return fallbackAvatar(login);
  const img = h('img', { class: 'avatar', src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(fallbackAvatar(login)), { once: true });
  return img;
}

function labelTextColor(hex) {
  const value = parseInt(hex, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? '#1f2328' : '#ffffff';
}

function labelChip(label) {
  const el = h('span', { class: 'pr-label', title: label.name }, label.name);
  if (LABEL_COLOR.test(label.color ?? '')) {
    const hex = label.color.replace('#', '');
    el.style.backgroundColor = `#${hex}`;
    el.style.color = labelTextColor(hex);
  }
  return el;
}

function row(className, ...children) {
  const items = children.flat().filter((child) => child != null && child !== false);
  return items.length ? h('div', { class: `row ${className}` }, items) : null;
}

function checksBadge(checks) {
  const state = CHECK_ICON[checks.state] ? checks.state : 'neutral';
  const lines = (checks.items ?? []).map((item) =>
    item.description ? `${item.context}: ${item.status} — ${item.description}` : `${item.context}: ${item.status}`,
  );
  return h(
    'span',
    { class: 'checks', 'data-state': state, title: lines.join('\n') || null },
    icon(CHECK_ICON[state]),
    `${checks.success}/${checks.total}`,
  );
}

function branchChip(name) {
  return h('span', { class: 'branch', title: name }, name);
}

function reviewerChip(reviewer, showStatus) {
  const state = REVIEW_TEXT[reviewer.state] ? reviewer.state : 'commented';
  const stale = showStatus && reviewer.stale === true;
  let title = reviewer.login;
  if (showStatus) title = `${reviewer.login}: ${REVIEW_TEXT[state]}${stale ? ' (이전 커밋 기준 리뷰)' : ''}`;
  return h(
    'span',
    { class: stale ? 'person reviewer stale' : 'person reviewer', 'data-review-state': state, title },
    h(
      'span',
      { class: 'avatar-wrap' },
      avatar(reviewer),
      showStatus ? h('span', { class: 'review-badge' }, icon(REVIEW_ICON[state])) : null,
    ),
    h('span', { class: 'login' }, reviewer.login),
  );
}

// 화면 공간을 줄이기 위해 구분 텍스트 없이 아바타만 표시하고, 역할과 전체 목록은 툴팁으로 제공한다.
function avatarStack(role, users) {
  const list = (users ?? []).filter(Boolean);
  if (!list.length) return null;
  const shown = list.slice(0, STACK_LIMIT);
  const extra = list.length - shown.length;
  return h(
    'span',
    { class: 'avatar-stack', title: `${role}: ${list.map((user) => user.login).join(', ')}` },
    shown.map((user) => avatar(user)),
    extra > 0 ? h('span', { class: 'avatar more' }, `+${extra}`) : null,
  );
}

function reviewSummary(reviewers) {
  const counts = countReviewStates(reviewers);
  const parts = [];
  for (const [state, text] of REVIEW_SUMMARY) {
    if (!counts[state]) continue;
    if (parts.length) parts.push(' · ');
    parts.push(h('span', { class: `rs-${state}` }, `${text} ${counts[state]}`));
  }
  return h('span', { class: 'chip review-summary' }, parts.length ? parts : '리뷰어 없음');
}

function mergeBadge(mergeable) {
  const text = mergeable ? '병합 가능' : '충돌';
  return h(
    'span',
    { class: 'merge-state', 'data-mergeable': mergeable ? 'true' : 'false', title: text, 'aria-label': text },
    icon(mergeable ? 'gitMerge' : 'alert'),
  );
}

function authorBadge(author) {
  return h(
    'span',
    { class: 'person author', title: `작성자: ${author.login}` },
    avatar(author),
    h('span', { class: 'login' }, author.login),
  );
}

// 행 A: 저장소·번호 | 작성자 | 담당자 | 참여자 … CI 상태, 병합 가능 여부
function metaRow(pr, f) {
  let path = '';
  if (f.owner && f.repo) path = `${pr.owner}/${pr.repo}`;
  else if (f.owner) path = pr.owner;
  else if (f.repo) path = pr.repo;
  const people = [
    f.author && pr.author ? authorBadge(pr.author) : null,
    f.assignees ? avatarStack('담당자', pr.assignees) : null,
    f.participants ? avatarStack('참여자', pr.participants) : null,
  ].filter(Boolean);
  const status = [
    f.checks && pr.checks ? checksBadge(pr.checks) : null,
    f.mergeable && typeof pr.mergeable === 'boolean' ? mergeBadge(pr.mergeable) : null,
  ].filter(Boolean);
  return row(
    'row-meta',
    h(
      'span',
      { class: 'pr-ref' },
      path ? h('span', { class: 'repo-path', title: path }, path) : null,
      h('span', { class: 'pr-number' }, `#${pr.number}`),
      people.flatMap((person) => [h('span', { class: 'sep', 'aria-hidden': 'true' }, '|'), person]),
    ),
    status.length ? h('span', { class: 'meta-status' }, status) : null,
  );
}

// 행 B: 제목 … 변경 규모
function titleRow(pr, f) {
  return h(
    'div',
    { class: 'row-title' },
    h(
      'div',
      { class: 'pr-title', title: pr.title },
      f.draft && pr.draft === true ? h('span', { class: 'draft-chip' }, 'Draft') : null,
      pr.title,
    ),
    f.diffStat && Number.isFinite(pr.additions) ? diffStat(pr) : null,
  );
}

function branchRow(pr, f) {
  const head = f.headBranch && pr.headBranch ? branchChip(pr.headBranch) : null;
  const base = f.baseBranch && pr.baseBranch ? branchChip(pr.baseBranch) : null;
  const arrow = h('span', { class: 'branch-arrow' }, '→');
  if (head && base) return row('row-branches', head, arrow, base);
  if (head) return row('row-branches', head);
  if (base) return row('row-branches', arrow, base);
  return null;
}

function reviewersRow(pr, f) {
  if (!f.reviewers || !pr.reviewers?.length) return null;
  return row(
    'row-people',
    h('span', { class: 'row-label' }, '리뷰'),
    pr.reviewers.map((reviewer) => reviewerChip(reviewer, Boolean(f.reviewStatus))),
  );
}

function commentChip(pr) {
  const conversation = Number(pr.comments) || 0;
  const hasReview = Number.isFinite(pr.reviewComments);
  return h(
    'span',
    {
      class: 'comment-count',
      title: hasReview ? `대화 ${conversation} · 코드 리뷰 ${pr.reviewComments}` : null,
    },
    icon('comment'),
    String(conversation + (hasReview ? pr.reviewComments : 0)),
  );
}

function diffStat(pr) {
  return h(
    'span',
    { class: 'diff-stat' },
    h('span', { class: 'diff-add' }, `+${pr.additions}`),
    ' ',
    h('span', { class: 'diff-del' }, `−${Number.isFinite(pr.deletions) ? pr.deletions : 0}`),
    Number.isFinite(pr.changedFiles) ? ` · 파일 ${pr.changedFiles}` : null,
  );
}

// 행 E: 라벨·마일스톤 … 댓글 수
function tagsRow(pr, f) {
  const tags = [
    f.reviewStatus && !f.reviewers && pr.reviewers ? reviewSummary(pr.reviewers) : null,
    f.labels ? (pr.labels ?? []).map(labelChip) : null,
    f.milestone && pr.milestone
      ? h(
          'span',
          { class: 'milestone', title: `마일스톤: ${pr.milestone.title}` },
          icon('milestone'),
          h('span', { class: 'milestone-title' }, pr.milestone.title),
        )
      : null,
  ]
    .flat()
    .filter(Boolean);
  return row(
    'row-tags',
    tags.length ? h('span', { class: 'tags' }, tags) : null,
    f.comments ? commentChip(pr) : null,
  );
}

// 행 F: 생성 · 최근 업데이트 · 마감일
function datesRow(pr, f, now) {
  return row(
    'row-dates',
    f.createdAt ? timeChip('created', '생성', pr.createdAt, now) : null,
    f.updatedAt ? timeChip('updated', '업데이트', pr.updatedAt, now) : null,
    f.dueDate && pr.dueDate ? dueChip(pr.dueDate, now) : null,
  );
}

function renderCard(pr, f, now) {
  const href = SAFE_URL.test(pr.url ?? '') ? pr.url : null;
  return h(
    'a',
    { class: 'pr-card', href, target: href ? '_blank' : null, rel: 'noopener', 'data-key': pr.key },
    metaRow(pr, f),
    titleRow(pr, f),
    branchRow(pr, f),
    reviewersRow(pr, f),
    tagsRow(pr, f),
    datesRow(pr, f, now),
  );
}

export function renderTabs(nav, tabs, counts, activeKey, onSelect) {
  const hadFocus = nav.contains(document.activeElement);
  const buttons = tabs.map((tab, index) => {
    const active = tab.key === activeKey;
    const button = h(
      'button',
      {
        class: 'tab',
        type: 'button',
        role: 'tab',
        'data-tab': tab.key,
        'aria-selected': active ? 'true' : 'false',
        tabindex: active ? '0' : '-1',
      },
      tab.label,
      h('span', { class: 'count' }, String(counts?.[tab.key] ?? 0)),
    );
    button.addEventListener('click', () => onSelect(tab.key));
    button.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      onSelect(tabs[next].key);
    });
    return button;
  });
  nav.replaceChildren(...buttons);
  if (hadFocus) nav.querySelector('[aria-selected="true"]')?.focus();
}

export function renderList(container, prs, fields, { emptyText = '', now = Date.now() } = {}) {
  if (!prs?.length) {
    container.replaceChildren(h('div', { class: 'empty' }, emptyText));
    return;
  }
  const f = fields ?? {};
  container.replaceChildren(...prs.map((pr) => renderCard(pr, f, now)));
}

export function renderSkeleton(container) {
  const cards = Array.from({ length: 3 }, () =>
    h(
      'div',
      { class: 'skeleton-card', 'aria-hidden': 'true' },
      h('div', { class: 'sk-line sk-short' }),
      h('div', { class: 'sk-line sk-title' }),
      h('div', { class: 'sk-line sk-half' }),
      h('div', { class: 'sk-line sk-medium' }),
    ),
  );
  container.replaceChildren(...cards);
}
