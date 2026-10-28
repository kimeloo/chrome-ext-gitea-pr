// Gitea 응답을 화면용 값으로 집계하는 순수 함수 모음. DOM과 chrome에 의존하지 않는다.

export function toUser(u) {
  return u ? { login: u.login, avatarUrl: u.avatar_url || '' } : null;
}

const REVIEW_STATE_MAP = {
  APPROVED: 'approved',
  REQUEST_CHANGES: 'changes_requested',
  REQUEST_REVIEW: 'pending',
};

// Gitea 사이드바의 리뷰어 표시와 같은 규칙으로 사용자별 최종 리뷰 상태를 계산한다.
export function summarizeReviews({ authorLogin, requested = [], reviews = [] }) {
  const entries = new Map();
  const entryOf = (user) => {
    let entry = entries.get(user.login);
    if (!entry) {
      entry = { login: user.login, avatarUrl: user.avatar_url || '', decisive: null, commented: false };
      entries.set(user.login, entry);
    }
    return entry;
  };

  const sorted = [...reviews].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  for (const r of sorted) {
    // 사용자 없는 항목은 팀 리뷰 요청이다.
    if (!r.user || r.user.login === authorLogin || r.dismissed) continue;
    if (Object.hasOwn(REVIEW_STATE_MAP, r.state)) {
      entryOf(r.user).decisive = r;
    } else if (r.state === 'COMMENT') {
      entryOf(r.user).commented = true;
    }
  }

  // 현재 대기 중인 리뷰 요청이 과거 리뷰보다 우선한다.
  for (const user of requested) {
    if (!user?.login || user.login === authorLogin) continue;
    entryOf(user).decisive = { state: 'REQUEST_REVIEW', stale: false };
  }

  return [...entries.values()].map((e) => ({
    login: e.login,
    avatarUrl: e.avatarUrl,
    state: e.decisive ? REVIEW_STATE_MAP[e.decisive.state] : 'commented',
    stale: Boolean(e.decisive?.stale),
  }));
}

export function countReviewStates(reviewers) {
  const counts = { approved: 0, changes_requested: 0, pending: 0, commented: 0 };
  for (const r of reviewers) counts[r.state] += 1;
  return counts;
}

// 커밋 상태가 하나도 없으면 null을 반환한다. Gitea는 이 경우 빈 CombinedStatus를 돌려준다.
export function summarizeChecks(combined) {
  const statuses = combined?.statuses;
  if (!Array.isArray(statuses) || statuses.length === 0) return null;

  let success = 0;
  let failure = 0;
  let warning = 0;
  let pending = 0;
  for (const s of statuses) {
    switch (s.status) {
      case 'success':
        success += 1;
        break;
      case 'failure':
      case 'error':
        failure += 1;
        break;
      case 'warning':
        warning += 1;
        break;
      case 'pending':
        pending += 1;
        break;
      default:
        // skipped 등은 total에만 포함한다.
        break;
    }
  }

  let state = 'neutral';
  if (failure > 0) state = 'failure';
  else if (warning > 0) state = 'warning';
  else if (pending > 0) state = 'pending';
  else if (success > 0) state = 'success';

  return {
    state,
    total: statuses.length,
    success,
    failure,
    warning,
    pending,
    items: statuses.map((s) => ({
      context: s.context,
      status: s.status,
      description: s.description || '',
      targetUrl: s.target_url || '',
    })),
  };
}

function norm(u) {
  return u?.login ? { login: u.login, avatarUrl: u.avatar_url ?? u.avatarUrl ?? '' } : null;
}

// 참여자 = 작성자 + 댓글 작성자 + 리뷰 작성자. 리뷰 요청과 임시 저장 리뷰는 제외한다.
export function collectParticipants({ author, comments = [], reviews = [] }) {
  const seen = new Map();
  const add = (u) => {
    const user = norm(u);
    if (user && !seen.has(user.login)) seen.set(user.login, user);
  };

  add(author);
  for (const c of comments) add(c.user);
  for (const r of reviews) {
    if (r.state !== 'PENDING' && r.state !== 'REQUEST_REVIEW') add(r.user);
  }
  return [...seen.values()];
}
