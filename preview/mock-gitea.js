// 미리보기 전용 가짜 Gitea 서버이다. 확장 프로그램이 호출하는 REST API와 시나리오 이벤트를 흉내 낸다.
// DOM과 Node API를 사용하지 않으며, 상태 저장은 호출자가 넘긴 load/save에 맡긴다.

const STATE_VERSION = 1;
const ME = 'me';
const ACTORS = ['alice', 'bob', 'carol', 'dave', 'erin'];
const TOKEN_MODES = ['ok', 'invalid', 'noNotification'];
const DEFAULT_NETWORK = { offline: false, slow: false, tokenMode: 'ok' };
const PR_STATES = ['open', 'closed', 'merged'];
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 50;
// 시나리오로 새로 여는 PR 번호는 초기 데이터와 겹치지 않고, 초기화 후에도 재사용되지 않는다.
const FIRST_NEW_PULL = 70;

const MINUTE = 60 * 1000;
// 아래 데이터 정의에서 쓰는 분 단위 길이이다.
const H = 60;
const D = 24 * H;

const URL_PATTERN = /^(.*?)\/api\/v1(?=[/?#]|$)(\/[^?#]*)?(?:\?([^#]*))?/;
const NOT_FOUND = { status: 404, data: { message: 'not found' } };

const USER_LIST = [
  ['me', '미리보기 사용자'],
  ['alice', 'Alice Kim'],
  ['bob', 'Bob Lee'],
  ['carol', 'Carol Choi'],
  ['dave', 'Dave Jung'],
  ['erin', 'Erin Han'],
  ['frank', 'Frank Yoon'],
  ['grace', 'Grace Shin'],
  ['henry', 'Henry Seo'],
  ['irene', 'Irene Moon'],
];
const USERS = new Map(
  USER_LIST.map(([login, fullName], i) => [login, { id: i + 1, login, full_name: fullName, avatar_url: '' }]),
);
const userOf = (login) => ({ ...(USERS.get(login) ?? { id: 0, login, full_name: login, avatar_url: '' }) });

const REPOS = [
  { id: 1, owner: 'acme', name: 'web' },
  { id: 2, owner: 'acme', name: 'api' },
  { id: 3, owner: 'platform', name: 'infra' },
  { id: 4, owner: 'mobile', name: 'app' },
].map((r) => ({ ...r, full_name: `${r.owner}/${r.name}` }));
const REPO_BY_FULL = new Map(REPOS.map((r) => [r.full_name, r]));
const repoLookup = (owner, name) => REPOS.find(
  (r) => r.owner.toLowerCase() === owner.toLowerCase() && r.name.toLowerCase() === name.toLowerCase(),
);

// 밝은 색과 어두운 색을 섞어 라벨 글자색 계산이 모두 쓰이게 한다.
const LABEL_COLORS = {
  feature: '0e8a16',
  bug: 'd73a4a',
  'needs-qa': 'fbca04',
  flaky: 'ededed',
  refactor: 'c5def5',
  wip: '24292e',
  documentation: '0075ca',
  backend: '1d76db',
  'breaking-change': 'b60205',
  security: '5319e7',
  infra: '0052cc',
  chore: 'fef2c0',
  dependencies: 'c2e0c6',
  ios: '000000',
  android: '3ddc84',
  urgent: 'e11d21',
  experiment: 'f9d0c4',
};

// 마일스톤 마감일은 지금 기준 상대 분이며 음수는 이미 지난 마감일이다.
const MILESTONE_DUE = { 'v1.2': 12 * D, 'v1.3': 30 * D, 'v2.0': 40 * D, '2분기 정비': 20 * D, '정기 릴리스': -3 * D };

const COMMENT_BODIES = [
  '변경 의도는 이해했습니다. 아래 두 부분만 확인 부탁드립니다.',
  'LGTM overall. A couple of minor nits inline.',
  '이 로직은 별도 함수로 분리하면 테스트하기 더 쉬울 것 같습니다.',
  '로컬에서 다시 확인해 보니 재현되지 않습니다. CI를 한 번 더 돌려 보겠습니다.',
  'Could you add a test case for the empty input?',
  '반영했습니다. 다시 확인 부탁드립니다.',
  '충돌이 생겨서 base 브랜치 기준으로 리베이스했습니다.',
  '릴리스 전에 꼭 머지되어야 하는 변경입니다.',
];

const NEW_PULL_POOL = [
  ['검색 결과 정렬 옵션 추가', 'feature/search-sort-options'],
  ['프로필 이미지 업로드 용량 제한 안내 문구 개선', 'feature/avatar-upload-limit-hint'],
  ['다크 모드에서 표 헤더 색상 대비 수정', 'fix/dark-table-header-contrast'],
  ['주문 내역 CSV 내보내기 기능', 'feature/order-history-csv-export'],
  ['접근성: 모달 포커스 트랩 적용', 'feature/a11y-modal-focus-trap'],
  ['라우트 단위 코드 분할로 번들 크기 축소', 'perf/route-level-code-splitting'],
];

// reviews: [작성자, 상태, stale, 몇 분 전], comments: [작성자, 몇 분 전], checks: [context, status, 설명]
// created/updated는 몇 분 전, due는 지금부터 몇 분 뒤(음수면 지남)이다.
const PR_DEFS = [
  {
    repo: 'acme/web', number: 42, title: '로그인 화면 리디자인 및 소셜 로그인 버튼 추가', author: 'dave',
    labels: ['feature', 'needs-qa'], milestone: 'v1.2', assignees: ['erin'], requested: ['me', 'carol'],
    base: 'main', head: 'feature/login-redesign', diff: [120, 30, 5], reviewComments: 2, mergeable: true,
    created: 3 * D, updated: 2 * H, due: -1 * D,
    reviews: [['alice', 'APPROVED', false, 20 * H], ['bob', 'REQUEST_CHANGES', false, 6 * H]],
    comments: [['carol', 30 * H], ['dave', 26 * H], ['bob', 5 * H]],
    checks: [['build', 'success', '빌드 성공'], ['lint', 'success', ''], ['test', 'failure', '테스트 2건 실패']],
  },
  {
    repo: 'acme/web', number: 57, title: 'Fix flaky date picker test on Safari', author: 'me',
    labels: ['bug', 'flaky'], requested: ['alice', 'bob'],
    base: 'main', head: 'fix/date-picker-flaky-test', diff: [24, 9, 2], reviewComments: 0, mergeable: true,
    created: 2 * D, updated: 40,
    reviews: [['carol', 'COMMENT', false, 3 * H]],
    comments: [['carol', 3 * H], ['alice', 90]],
    checks: [['build', 'success', ''], ['test', 'pending', '실행 중']],
  },
  {
    repo: 'acme/web', number: 61, title: '[WIP] 결제 모듈 분리: PaymentService 추출', author: 'me', draft: true,
    labels: ['refactor', 'wip'], milestone: 'v1.3', assignees: ['me', 'erin'], requested: ['dave'],
    base: 'develop', head: 'refactor/payment-service', diff: [410, 268, 17], reviewComments: 0, mergeable: false,
    created: 6 * D, updated: 1 * D, due: 9 * D,
    comments: [['dave', 2 * D]],
    checks: [],
  },
  {
    repo: 'acme/web', number: 64, title: '문서: 설치 가이드의 오타와 깨진 링크 수정', author: 'frank',
    labels: ['documentation'],
    base: 'main', head: 'docs/install-guide-typos', diff: [3, 3, 1], reviewComments: 0, mergeable: true,
    created: 2 * D, updated: 47 * H,
    reviews: [['me', 'PENDING', false, 1 * D]],
    checks: [['build', 'success', '']],
  },
  {
    repo: 'acme/web', number: 38, title: 'Experiment: switch bundler to Rspack', author: 'erin', state: 'closed', closedBy: 'erin',
    labels: ['experiment'],
    base: 'main', head: 'experiment/rspack', diff: [88, 40, 12], reviewComments: 1, mergeable: false,
    created: 20 * D, updated: 9 * D,
    reviews: [['alice', 'COMMENT', false, 10 * D]],
    comments: [['bob', 12 * D], ['erin', 9 * D]],
    checks: [['build', 'failure', '번들 오류']],
  },
  {
    repo: 'acme/api', number: 17, title: '목록 API에 커서 기반 페이지네이션 적용', author: 'erin',
    labels: ['backend', 'breaking-change'], milestone: 'v2.0', assignees: ['erin', 'frank'], requested: ['me'],
    base: 'develop', head: 'feature/cursor-pagination', diff: [342, 87, 14], reviewComments: 5, mergeable: false,
    created: 9 * D, updated: 26 * H, due: 5 * D,
    reviews: [['alice', 'APPROVED', true, 5 * D], ['dave', 'COMMENT', false, 3 * D]],
    comments: [['frank', 8 * D], ['alice', 6 * D], ['bob', 4 * D], ['carol', 2 * D]],
    checks: [['build', 'success', ''], ['integration', 'pending', '실행 중']],
  },
  {
    repo: 'acme/api', number: 23, title: 'Add rate limiting middleware (token bucket)', author: 'bob',
    labels: ['backend', 'security'], assignees: ['me'],
    base: 'main', head: 'feature/rate-limit-token-bucket', diff: [215, 12, 6], reviewComments: 3, mergeable: true,
    created: 5 * D, updated: 3 * H, due: 2 * D,
    reviews: [['alice', 'COMMENT', false, 2 * D], ['me', 'APPROVED', false, 20 * H]],
    comments: [['alice', 2 * D], ['bob', 4 * H]],
    checks: [['build', 'success', ''], ['unit', 'success', '412 passed'], ['coverage', 'success', 'coverage 87%']],
  },
  {
    repo: 'platform/infra', number: 8, title: 'Terraform 모듈 버전 고정 및 상태 백엔드 이전', author: 'grace',
    labels: ['infra', 'chore'], milestone: '2분기 정비', assignees: ['grace', 'henry', 'me'], mentions: ['me'],
    base: 'main', head: 'chore/terraform-pin', diff: [58, 41, 9], reviewComments: 4, mergeable: true,
    created: 21 * D, updated: 15, due: 3 * D,
    reviews: [['alice', 'APPROVED', false, 3 * D], ['henry', 'APPROVED', false, 2 * D], ['me', 'REQUEST_CHANGES', false, 6 * H]],
    comments: [['irene', 18 * D], ['alice', 15 * D], ['grace', 14 * D], ['henry', 10 * D], ['alice', 6 * D], ['me', 5 * H], ['grace', 20]],
    checks: [['plan', 'success', ''], ['validate', 'success', ''], ['security-scan', 'success', '']],
  },
  {
    repo: 'platform/infra', number: 12, title: 'chore(deps): bump ingress-nginx chart to 4.11', author: 'carol',
    labels: ['dependencies'], mentions: ['me'],
    base: 'main', head: 'deps/ingress-nginx-4.11', diff: [6, 6, 2], reviewComments: 0, mergeable: true,
    created: 14 * D, updated: 12 * D,
    comments: [['carol', 12 * D]],
    checks: [],
  },
  {
    repo: 'platform/infra', number: 15, title: 'Add staging cluster autoscaler config', author: 'henry', state: 'merged', closedBy: 'grace',
    labels: ['infra'], milestone: '2분기 정비', assignees: ['henry'],
    base: 'main', head: 'feature/staging-autoscaler', diff: [74, 10, 4], reviewComments: 1, mergeable: false,
    created: 8 * D, updated: 6 * D,
    reviews: [['alice', 'APPROVED', false, 6 * D + 3 * H]],
    comments: [['grace', 7 * D]],
    checks: [['plan', 'success', ''], ['validate', 'success', '']],
  },
  {
    repo: 'mobile/app', number: 104, title: 'iOS 푸시 알림 권한 요청 시점을 온보딩 이후로 지연', author: 'alice',
    labels: ['ios', 'feature'], assignees: ['bob'], requested: ['me', 'bob'],
    base: 'main', head: 'feature/ios-push-permission-after-onboarding', diff: [67, 12, 2], reviewComments: 1, mergeable: true,
    created: 1 * D, updated: 5 * H, due: 7 * D,
    reviews: [['carol', 'APPROVED', false, 8 * H]],
    comments: [['bob', 10 * H]],
    checks: [['ios-build', 'success', ''], ['ios-test', 'success', '']],
  },
  {
    repo: 'mobile/app', number: 109,
    title: 'Crash on Android 14 when rotating the device during camera preview: restore the capture session state and release the surface texture without leaking memory',
    author: 'bob',
    labels: ['bug', 'android', 'urgent'], milestone: '정기 릴리스', assignees: ['carol'], requested: ['erin'], mentions: ['me'],
    base: 'main', head: 'bugfix/android14-camera-preview-rotation-lifecycle-crash-restore-capture-session-without-surface-leak',
    diff: [15, 4, 1], reviewComments: 2, mergeable: false,
    created: 4 * H, updated: 4, due: 1 * D,
    reviews: [['dave', 'REQUEST_CHANGES', false, 30]],
    comments: [['carol', 3 * H], ['bob', 20]],
    checks: [['build', 'success', ''], ['lint', 'warning', '경고 3건'], ['e2e', 'failure', '카메라 시나리오 실패']],
  },
];

// 순서는 시뮬레이터 버튼 표시 순서이다.
const EVENT_TABLE = [
  ['newPull', '새 PR 열기', 'PR', false, true],
  ['reviewRequested', '나를 리뷰어로 지정', '사람', true, true],
  ['assigned', '나를 담당자로 지정', '사람', true, true],
  ['comment', '코멘트 작성', '대화', true, true],
  ['reviewApproved', '승인 리뷰', '대화', true, true],
  ['reviewChangesRequested', '변경 요청 리뷰', '대화', true, true],
  ['pushed', '새 커밋 푸시', 'PR', true, false],
  ['merged', '머지', 'PR', true, true],
  ['closed', '닫기', 'PR', true, true],
  ['reopened', '다시 열기', 'PR', true, true],
  ['checkSuccess', '체크 성공', 'CI', true, false],
  ['checkFailure', '체크 실패', 'CI', true, false],
  ['checkPending', '체크 진행 중', 'CI', true, false],
].map(([kind, label, group, needsPr, needsActor]) => ({ kind, label, group, needsPr, needsActor }));
const EVENT_BY_KIND = new Map(EVENT_TABLE.map((e) => [e.kind, e]));

const ROLE_FILTERS = {
  review_requested: (pr) => pr.requested.includes(ME),
  created: (pr) => pr.author === ME,
  assigned: (pr) => pr.assignees.includes(ME),
  reviewed: (pr) => pr.reviews.some((r) => r.user === ME && r.state !== 'PENDING' && r.state !== 'REQUEST_REVIEW'),
  mentioned: (pr) => pr.mentions.includes(ME),
};

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ok = (data, total) => ({ status: 200, data, total });
const fail = (status, message) => ({ status, data: { message } });
const result = (success, message) => ({ ok: success, message });

// 체크 이벤트는 head 커밋의 상태를 build/test 두 항목으로 교체한다.
const CHECK_OUTCOMES = {
  success: { to: '성공으로', statuses: [['build', 'success', '빌드 성공'], ['test', 'success', '테스트 통과']] },
  failure: { to: '실패로', statuses: [['build', 'success', '빌드 성공'], ['test', 'failure', '테스트 3건 실패']] },
  pending: { to: '진행 중으로', statuses: [['build', 'pending', '실행 중'], ['test', 'pending', '실행 중']] },
};

function randomSha() {
  let sha = '';
  while (sha.length < 40) sha += Math.floor(Math.random() * 16).toString(16);
  return sha;
}

const prKeyOf = (pr) => `${pr.repo}#${pr.number}`;
const prLabel = (pr) => `${pr.repo} #${pr.number}`;
const prUrl = (base, pr) => `${base}/${pr.repo}/pulls/${pr.number}`;
const commentUrl = (base, pr, id) => `${prUrl(base, pr)}#issuecomment-${id}`;

// ---------------------------------------------------------------------------
// 응답 직렬화. 주소는 요청의 base에 맞춰 응답 시점에 만든다.

function issueJson(pr, base) {
  const repo = REPO_BY_FULL.get(pr.repo);
  const html = prUrl(base, pr);
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    html_url: html,
    user: userOf(pr.author),
    labels: pr.labels.map((l) => ({ ...l })),
    milestone: pr.milestone ? { ...pr.milestone } : null,
    assignees: pr.assignees.map(userOf),
    comments: pr.comments.length,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    due_date: pr.due_date ?? null,
    state: pr.state === 'open' ? 'open' : 'closed',
    pull_request: { draft: pr.draft, merged: pr.state === 'merged', html_url: html },
    // 검색 결과에서 repository.owner는 객체가 아니라 로그인 문자열이다.
    repository: { id: repo.id, name: repo.name, owner: repo.owner, full_name: repo.full_name },
  };
}

function pullJson(pr, base) {
  const [owner] = pr.repo.split('/');
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    html_url: prUrl(base, pr),
    user: userOf(pr.author),
    state: pr.state === 'open' ? 'open' : 'closed',
    merged: pr.state === 'merged',
    draft: pr.draft,
    mergeable: pr.state === 'merged' ? false : pr.mergeable,
    base: { ref: pr.base, label: `${owner}:${pr.base}` },
    head: { ref: pr.head.ref, label: `${owner}:${pr.head.ref}`, sha: pr.head.sha },
    additions: pr.additions,
    deletions: pr.deletions,
    changed_files: pr.changed_files,
    review_comments: pr.review_comments,
    requested_reviewers: pr.requested.map(userOf),
    created_at: pr.created_at,
    updated_at: pr.updated_at,
  };
}

const reviewJson = (r, pr, base) => ({
  id: r.id,
  user: userOf(r.user),
  state: r.state,
  stale: r.stale,
  dismissed: false,
  submitted_at: r.submitted_at,
  html_url: commentUrl(base, pr, r.id),
});

const commentJson = (c, pr, base) => ({
  id: c.id,
  user: userOf(c.user),
  body: c.body,
  html_url: commentUrl(base, pr, c.id),
  created_at: c.created_at,
});

const timelineJson = (item, pr, base) => ({
  id: item.id,
  type: item.type,
  user: userOf(item.user),
  html_url: commentUrl(base, pr, item.id),
  created_at: item.created_at,
  assignee: item.assignee ? userOf(item.assignee) : null,
  removed_assignee: false,
});

function combinedState(statuses) {
  if (statuses.some((s) => s.status === 'failure' || s.status === 'error')) return 'failure';
  if (statuses.some((s) => s.status === 'warning')) return 'warning';
  if (statuses.some((s) => s.status === 'pending')) return 'pending';
  return statuses.length > 0 ? 'success' : 'pending';
}

function threadJson(thread, pr, base) {
  const repo = REPO_BY_FULL.get(pr.repo);
  return {
    id: thread.id,
    repository: {
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      owner: { login: repo.owner },
    },
    subject: {
      title: pr.title,
      url: `${base}/api/v1/repos/${pr.repo}/issues/${pr.number}`,
      html_url: prUrl(base, pr),
      latest_comment_url: '',
      latest_comment_html_url: '',
      type: 'Pull',
      state: pr.state,
    },
    unread: true,
    pinned: false,
    updated_at: thread.updated_at,
  };
}

// ---------------------------------------------------------------------------
// 요청 해석

function parseUrl(url) {
  const raw = typeof url === 'string' ? url : String(url?.url ?? url);
  const m = URL_PATTERN.exec(raw);
  if (!m) return null;
  let segments;
  try {
    segments = (m[2] ?? '').split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  return { base: m[1], segments, params: new URLSearchParams(m[3] ?? '') };
}

function headerOf(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) ?? '';
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);
  const found = entries.find(([key]) => String(key).toLowerCase() === name);
  return found ? String(found[1]) : '';
}

function tokenOf(headers) {
  const match = /^\s*(?:token|bearer)\s+(\S.*?)\s*$/i.exec(headerOf(headers, 'authorization'));
  return match ? match[1] : '';
}

function sinceMs(value) {
  const ms = Date.parse(value ?? '');
  return Number.isNaN(ms) ? -Infinity : ms;
}

function paginate(list, params) {
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(params.get('limit'), 10) || DEFAULT_PAGE_SIZE));
  const page = Math.max(1, Number.parseInt(params.get('page'), 10) || 1);
  return list.slice((page - 1) * limit, page * limit);
}

function toWire({ status, data, total }) {
  const headers = { 'Content-Type': 'application/json', Date: new Date().toUTCString() };
  if (total !== undefined) headers['X-Total-Count'] = String(total);
  return { status, headers, body: JSON.stringify(data) };
}

// ---------------------------------------------------------------------------
// 데이터 조작 도구와 초기 데이터셋

function makeOps(nextId) {
  const timelineItem = (pr, type, user, at, { id, assignee } = {}) => {
    const item = { id: id ?? nextId(), type, user, created_at: at, assignee: assignee ?? null };
    pr.timeline.push(item);
    return item;
  };
  return {
    timelineItem,
    comment(pr, user, at, body) {
      const id = nextId();
      pr.comments.push({ id, user, body, created_at: at });
      timelineItem(pr, 'comment', user, at, { id });
    },
    review(pr, user, state, at, stale = false) {
      const id = nextId();
      pr.reviews.push({ id, user, state, stale, submitted_at: at });
      // 임시 저장 리뷰는 타임라인에 나타나지 않는다.
      if (state !== 'PENDING') timelineItem(pr, 'review', user, at, { id });
    },
    statuses: (list) => list.map(([context, status, description]) => ({ id: nextId(), context, status, description })),
  };
}

function buildDataset(now, nextId, ops) {
  const iso = (minutesAgo) => new Date(now - minutesAgo * MINUTE).toISOString();
  const labelIds = new Map();
  const milestones = new Map();
  const byAgeDesc = (a, b) => b[b.length - 1] - a[a.length - 1];

  const labelOf = (name) => {
    if (!labelIds.has(name)) labelIds.set(name, nextId());
    return { id: labelIds.get(name), name, color: LABEL_COLORS[name] };
  };
  const milestoneOf = (title) => {
    if (!milestones.has(title)) milestones.set(title, { id: nextId(), title, due_on: iso(-MILESTONE_DUE[title]) });
    return { ...milestones.get(title) };
  };

  return PR_DEFS.map((def, index) => {
    const sha = randomSha();
    const pr = {
      id: nextId(),
      repo: def.repo,
      number: def.number,
      title: def.title,
      author: def.author,
      state: def.state ?? 'open',
      draft: def.draft ?? false,
      labels: (def.labels ?? []).map(labelOf),
      milestone: def.milestone ? milestoneOf(def.milestone) : null,
      assignees: [...(def.assignees ?? [])],
      requested: [...(def.requested ?? [])],
      mentions: [...(def.mentions ?? [])],
      mergeable: def.mergeable,
      base: def.base,
      head: { ref: def.head, sha },
      additions: def.diff[0],
      deletions: def.diff[1],
      changed_files: def.diff[2],
      review_comments: def.reviewComments,
      created_at: iso(def.created),
      updated_at: iso(def.updated),
      due_date: def.due === undefined ? null : iso(-def.due),
      comments: [],
      reviews: [],
      timeline: [],
      statuses: { [sha]: ops.statuses(def.checks) },
    };

    // 오래된 항목부터 만들어 id 순서가 시간 순서와 같게 한다.
    [...(def.comments ?? [])].sort(byAgeDesc).forEach(([user, minutesAgo], i) => {
      ops.comment(pr, user, iso(minutesAgo), COMMENT_BODIES[(index + i) % COMMENT_BODIES.length]);
    });
    [...(def.reviews ?? [])].sort(byAgeDesc).forEach(([user, state, stale, minutesAgo]) => {
      ops.review(pr, user, state, iso(minutesAgo), stale);
    });
    if (pr.state === 'merged') ops.timelineItem(pr, 'merge_pull', def.closedBy, pr.updated_at);
    if (pr.state === 'closed') ops.timelineItem(pr, 'close', def.closedBy, pr.updated_at);
    pr.timeline.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
    return pr;
  });
}

// ---------------------------------------------------------------------------
// 저장된 상태 검증

const isArrayOf = (value, check) => Array.isArray(value) && value.every(check);
const isString = (v) => typeof v === 'string';

function isValidPull(pr) {
  return Boolean(pr) && typeof pr === 'object'
    && REPO_BY_FULL.has(pr.repo)
    && Number.isInteger(pr.number) && Number.isInteger(pr.id)
    && isString(pr.title) && isString(pr.author)
    && PR_STATES.includes(pr.state)
    && isString(pr.created_at) && isString(pr.updated_at)
    && isArrayOf(pr.assignees, isString) && isArrayOf(pr.requested, isString) && isArrayOf(pr.mentions, isString)
    && Array.isArray(pr.labels) && Array.isArray(pr.comments) && Array.isArray(pr.reviews) && Array.isArray(pr.timeline)
    && Boolean(pr.head) && isString(pr.head.sha) && isString(pr.head.ref)
    && Boolean(pr.statuses) && typeof pr.statuses === 'object';
}

function isValidState(s) {
  if (!s || typeof s !== 'object' || s.version !== STATE_VERSION) return false;
  if (!s.network || typeof s.network !== 'object') return false;
  if (!s.counters || !Number.isInteger(s.counters.id) || !Number.isInteger(s.counters.pull)) return false;
  if (!Array.isArray(s.prs) || s.prs.length === 0 || !s.prs.every(isValidPull)) return false;
  const keys = new Set(s.prs.map(prKeyOf));
  return isArrayOf(s.threads, (t) => Boolean(t) && Number.isInteger(t.id) && isString(t.updated_at) && keys.has(t.prKey));
}

function mergeNetwork(base, patch) {
  const next = { ...base };
  if (typeof patch?.offline === 'boolean') next.offline = patch.offline;
  if (typeof patch?.slow === 'boolean') next.slow = patch.slow;
  if (TOKEN_MODES.includes(patch?.tokenMode)) next.tokenMode = patch.tokenMode;
  return next;
}

// ---------------------------------------------------------------------------

export function createMockGitea({ load, save } = {}) {
  let state = null;
  const listeners = new Set();
  const nextId = () => state.counters.id++;
  const ops = makeOps(nextId);

  function persist() {
    try {
      save?.(state);
    } catch (err) {
      console.warn('[mock-gitea] 상태 저장 실패', err);
    }
  }

  function emit() {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch (err) {
        console.error('[mock-gitea] 구독자 오류', err);
      }
    }
  }

  function commit() {
    persist();
    emit();
  }

  // 카운터는 초기화해도 이어 가야 확장 프로그램이 기억하는 이벤트 키와 겹치지 않는다.
  function createState(counters) {
    state = { version: STATE_VERSION, network: { ...DEFAULT_NETWORK }, counters, prs: [], threads: [] };
    state.prs = buildDataset(Date.now(), nextId, ops);
  }

  let loaded = null;
  try {
    loaded = load?.() ?? null;
  } catch {
    loaded = null;
  }
  if (isValidState(loaded)) {
    state = loaded;
    state.network = mergeNetwork(DEFAULT_NETWORK, loaded.network);
  } else {
    createState({ id: 1, pull: FIRST_NEW_PULL });
    persist();
  }

  const prByKey = (key) => state.prs.find((pr) => prKeyOf(pr) === key);
  const findPr = (owner, name, number) => {
    const full = `${owner}/${name}`.toLowerCase();
    return state.prs.find((pr) => pr.number === number && pr.repo.toLowerCase() === full);
  };

  function upsertThread(pr, at) {
    const key = prKeyOf(pr);
    const thread = state.threads.find((t) => t.prKey === key);
    if (thread) thread.updated_at = at;
    else state.threads.push({ id: nextId(), prKey: key, updated_at: at });
  }

  // 체크 이벤트를 제외한 모든 이벤트는 이슈 갱신 시각과 알림 스레드를 함께 갱신한다.
  function touch(pr, at) {
    pr.updated_at = at;
    upsertThread(pr, at);
  }

  function statusesOfSha(fullName, sha) {
    const lower = fullName.toLowerCase();
    for (const pr of state.prs) {
      if (pr.repo.toLowerCase() === lower && Object.hasOwn(pr.statuses, sha)) return pr.statuses[sha];
    }
    return [];
  }

  // -------------------------------------------------------------------------
  // REST 엔드포인트

  function searchIssues(params, base) {
    if (params.get('type') === 'issues') return ok([], 0);
    const wanted = params.get('state') ?? 'open';
    const roles = Object.keys(ROLE_FILTERS).filter((role) => params.get(role) === 'true');
    const matches = state.prs
      .filter((pr) => {
        if (wanted === 'open' && pr.state !== 'open') return false;
        if (wanted === 'closed' && pr.state === 'open') return false;
        return roles.every((role) => ROLE_FILTERS[role](pr));
      })
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.number - a.number);
    return ok(paginate(matches, params).map((pr) => issueJson(pr, base)), matches.length);
  }

  function listNotifications(params, base) {
    const types = params.getAll('subject-type');
    if (types.length > 0 && !types.includes('pull')) return ok([], 0);
    const since = sinceMs(params.get('since'));
    const rows = state.threads
      .filter((t) => Date.parse(t.updated_at) >= since)
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id);
    const page = paginate(rows, params);
    return ok(page.map((t) => threadJson(t, prByKey(t.prKey), base)), rows.length);
  }

  function listTimeline(pr, params, base) {
    const since = sinceMs(params.get('since'));
    const rows = pr.timeline
      .filter((item) => Date.parse(item.created_at) >= since)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
    return ok(paginate(rows, params).map((item) => timelineJson(item, pr, base)), rows.length);
  }

  function dispatch(segments, params, base) {
    const [root, owner, repoName, kind, key, leaf] = segments;

    if (root === 'user' && segments.length === 1) return ok({ ...userOf(ME) });

    if (root === 'notifications') {
      if (state.network.tokenMode === 'noNotification') {
        return fail(403, 'token does not have at least one of required scope(s): read:notification');
      }
      if (segments.length === 1) return listNotifications(params, base);
      if (segments.length === 2 && owner === 'new') return ok({ new: state.threads.length });
      return NOT_FOUND;
    }

    if (root !== 'repos') return NOT_FOUND;
    if (segments.length === 3 && owner === 'issues' && repoName === 'search') return searchIssues(params, base);
    if (segments.length !== 5 && segments.length !== 6) return NOT_FOUND;

    if (kind === 'commits' && leaf === 'status' && segments.length === 6) {
      const repo = repoLookup(owner, repoName);
      if (!repo) return NOT_FOUND;
      const statuses = statusesOfSha(repo.full_name, key);
      return ok({
        state: combinedState(statuses),
        sha: key,
        total_count: statuses.length,
        statuses: statuses.map((s) => ({
          id: s.id,
          context: s.context,
          status: s.status,
          description: s.description,
          target_url: `${base}/${repo.full_name}/actions/runs/${s.id}`,
        })),
      });
    }

    if (!/^\d+$/.test(key ?? '')) return NOT_FOUND;
    const pr = findPr(owner, repoName, Number(key));
    if (!pr) return NOT_FOUND;

    if (kind === 'pulls' && segments.length === 5) return ok(pullJson(pr, base));
    if (kind === 'pulls' && leaf === 'reviews') {
      const rows = [...pr.reviews].sort((a, b) => a.id - b.id);
      return ok(paginate(rows, params).map((r) => reviewJson(r, pr, base)), rows.length);
    }
    if (kind === 'issues' && leaf === 'comments') {
      return ok(pr.comments.map((c) => commentJson(c, pr, base)), pr.comments.length);
    }
    if (kind === 'issues' && leaf === 'timeline') return listTimeline(pr, params, base);
    return NOT_FOUND;
  }

  function respond(url, init) {
    if (!tokenOf(init?.headers) || state.network.tokenMode === 'invalid') return fail(401, 'token is invalid');
    const parsed = parseUrl(url);
    if (!parsed || parsed.segments.length === 0) return NOT_FOUND;
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return NOT_FOUND;
    return dispatch(parsed.segments, parsed.params, parsed.base);
  }

  async function handle(url, init) {
    await delay(state.network.slow ? randInt(1800, 2500) : randInt(150, 450));
    if (state.network.offline) throw new TypeError('Failed to fetch');
    return toWire(respond(url, init));
  }

  // -------------------------------------------------------------------------
  // 시나리오 이벤트

  const randomBody = () => COMMENT_BODIES[randInt(0, COMMENT_BODIES.length - 1)];

  function review(pr, actor, at, reviewState, text) {
    if (actor === pr.author) return result(false, `${actor}님은 이 PR의 작성자라서 ${text}할 수 없습니다.`);
    ops.review(pr, actor, reviewState, at);
    pr.requested = pr.requested.filter((login) => login !== actor);
    touch(pr, at);
    const what = reviewState === 'APPROVED' ? '승인 리뷰' : '변경 요청 리뷰';
    return result(true, `${actor}님이 ${prLabel(pr)}에 ${what}를 남겼습니다.`);
  }

  function setChecks(pr, outcome) {
    pr.statuses[pr.head.sha] = ops.statuses(outcome.statuses);
    const suffix = pr.author === ME ? '' : ' 체크 상태 알림은 내가 연 PR만 대상입니다.';
    return result(true, `${prLabel(pr)}의 체크 상태를 ${outcome.to} 바꿨습니다.${suffix}`);
  }

  const runners = {
    newPull(_pr, actor, at) {
      const number = state.counters.pull++;
      const [title, branch] = NEW_PULL_POOL[(number - FIRST_NEW_PULL) % NEW_PULL_POOL.length];
      const sha = randomSha();
      const pr = {
        id: nextId(),
        repo: 'acme/web',
        number,
        title,
        author: actor,
        state: 'open',
        draft: false,
        labels: [],
        milestone: null,
        assignees: [],
        requested: [],
        mentions: [],
        mergeable: true,
        base: 'main',
        head: { ref: branch, sha },
        additions: randInt(10, 220),
        deletions: randInt(0, 60),
        changed_files: randInt(1, 9),
        review_comments: 0,
        created_at: at,
        updated_at: at,
        due_date: null,
        comments: [],
        reviews: [],
        timeline: [],
        statuses: { [sha]: ops.statuses([['build', 'pending', '실행 중'], ['test', 'pending', '실행 중']]) },
      };
      state.prs.push(pr);
      upsertThread(pr, at);
      return result(true, `${actor}님이 새 PR을 열었습니다 (${prLabel(pr)}).`);
    },

    reviewRequested(pr, actor, at) {
      if (pr.author === ME) return result(false, '내가 연 PR에는 나를 리뷰어로 지정할 수 없습니다.');
      if (!pr.requested.includes(ME)) pr.requested.push(ME);
      ops.timelineItem(pr, 'review_request', actor, at, { assignee: ME });
      touch(pr, at);
      return result(true, `${actor}님이 ${prLabel(pr)}에서 나를 리뷰어로 지정했습니다.`);
    },

    assigned(pr, actor, at) {
      if (!pr.assignees.includes(ME)) pr.assignees.push(ME);
      ops.timelineItem(pr, 'assignees', actor, at, { assignee: ME });
      touch(pr, at);
      return result(true, `${actor}님이 ${prLabel(pr)}의 담당자로 나를 지정했습니다.`);
    },

    comment(pr, actor, at) {
      ops.comment(pr, actor, at, randomBody());
      touch(pr, at);
      return result(true, `${actor}님이 ${prLabel(pr)}에 코멘트를 남겼습니다.`);
    },

    reviewApproved: (pr, actor, at) => review(pr, actor, at, 'APPROVED', '승인'),
    reviewChangesRequested: (pr, actor, at) => review(pr, actor, at, 'REQUEST_CHANGES', '변경을 요청'),

    pushed(pr, _actor, at) {
      if (pr.author === ME) return result(false, '내가 연 PR에는 푸시 이벤트를 만들 수 없습니다. 다른 사람이 연 PR을 선택하세요.');
      const previous = pr.statuses[pr.head.sha] ?? [];
      const contexts = previous.length > 0 ? previous.map((s) => s.context) : ['build', 'test'];
      const sha = randomSha();
      pr.statuses[sha] = ops.statuses(contexts.map((context) => [context, 'pending', '실행 중']));
      pr.head.sha = sha;
      for (const r of pr.reviews) r.stale = true;
      pr.additions += randInt(5, 60);
      ops.timelineItem(pr, 'pull_push', pr.author, at);
      touch(pr, at);
      return result(true, `PR 작성자 ${pr.author}님이 ${prLabel(pr)}에 새 커밋을 푸시했습니다.`);
    },

    merged(pr, actor, at) {
      if (pr.state !== 'open') return result(false, '열린 PR만 머지할 수 있습니다.');
      pr.state = 'merged';
      ops.timelineItem(pr, 'merge_pull', actor, at);
      touch(pr, at);
      return result(true, `${actor}님이 ${prLabel(pr)} PR을 머지했습니다.`);
    },

    closed(pr, actor, at) {
      if (pr.state !== 'open') return result(false, '열린 PR만 닫을 수 있습니다.');
      pr.state = 'closed';
      ops.timelineItem(pr, 'close', actor, at);
      touch(pr, at);
      return result(true, `${actor}님이 ${prLabel(pr)} PR을 닫았습니다.`);
    },

    reopened(pr, actor, at) {
      if (pr.state === 'merged') return result(false, '머지된 PR은 다시 열 수 없습니다.');
      if (pr.state === 'open') return result(false, '이미 열려 있는 PR입니다. 닫힌 PR을 선택하세요.');
      pr.state = 'open';
      ops.timelineItem(pr, 'reopen', actor, at);
      touch(pr, at);
      return result(true, `${actor}님이 ${prLabel(pr)} PR을 다시 열었습니다.`);
    },

    checkSuccess: (pr) => setChecks(pr, CHECK_OUTCOMES.success),
    checkFailure: (pr) => setChecks(pr, CHECK_OUTCOMES.failure),
    checkPending: (pr) => setChecks(pr, CHECK_OUTCOMES.pending),
  };

  function trigger(kind, options) {
    const { prKey, actor } = options ?? {};
    const meta = EVENT_BY_KIND.get(kind);
    if (!meta) return result(false, '알 수 없는 이벤트입니다.');
    let pr = null;
    if (meta.needsPr) {
      pr = prByKey(prKey);
      if (!pr) return result(false, '대상 PR을 찾을 수 없습니다.');
    }
    if (meta.needsActor && !ACTORS.includes(actor)) return result(false, '이벤트를 만들 사용자를 선택하세요.');
    const outcome = runners[kind](pr, actor, new Date().toISOString());
    if (outcome.ok) commit();
    return outcome;
  }

  // -------------------------------------------------------------------------

  function setNetwork(patch) {
    const next = mergeNetwork(state.network, patch);
    const changed = Object.keys(next).some((key) => next[key] !== state.network[key]);
    state.network = next;
    if (changed) commit();
    return { ...next };
  }

  function listPulls() {
    const order = new Map(REPOS.map((r, i) => [r.full_name, i]));
    return state.prs
      .map((pr) => ({
        key: prKeyOf(pr),
        owner: pr.repo.split('/')[0],
        repo: pr.repo.split('/')[1],
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.author,
        mine: pr.author === ME,
      }))
      .sort((a, b) => order.get(`${a.owner}/${a.repo}`) - order.get(`${b.owner}/${b.repo}`) || a.number - b.number);
  }

  function reset() {
    createState(state.counters);
    commit();
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }

  return {
    handle,
    getNetwork: () => ({ ...state.network }),
    setNetwork,
    me: ME,
    actors: [...ACTORS],
    listPulls,
    eventKinds: EVENT_TABLE.map(({ kind, label, group }) => ({ kind, label, group })),
    trigger,
    reset,
    subscribe,
  };
}
