// 알림 이벤트 추출과 알림 문구 생성을 담당하는 순수 모듈이다. chrome과 DOM에 접근하지 않는다.

export const NOTIFY_ALARM = 'gpr-poll';

const ID_MARKER = '#gpr-';

// 앞에 있을수록 우선순위가 높다.
const KIND_PRIORITY = [
  'reviewRequested',
  'assigned',
  'merged',
  'checkFailure',
  'closed',
  'reopened',
  'review',
  'comment',
  'checkWarning',
  'checkSuccess',
  'pushed',
  'newPull',
];

const LABELS = {
  newPull: '새 PR',
  reviewRequested: '리뷰 요청',
  assigned: '담당 지정',
  comment: '코멘트',
  review: '리뷰',
  pushed: '새 커밋',
  merged: '머지됨',
  closed: '닫힘',
  reopened: '다시 열림',
  checkSuccess: '체크 성공',
  checkFailure: '체크 실패',
  checkWarning: '체크 경고',
};

const DESCRIPTIONS = {
  newPull: (a) => `${a}님이 새 PR을 열었습니다`,
  reviewRequested: (a) => `${a}님이 나를 리뷰어로 지정했습니다`,
  assigned: (a) => `${a}님이 나를 담당자로 지정했습니다`,
  comment: (a) => `${a}님이 코멘트를 남겼습니다`,
  review: (a) => `${a}님이 리뷰를 남겼습니다`,
  pushed: (a) => `${a}님이 새 커밋을 푸시했습니다`,
  merged: (a) => `${a}님이 머지했습니다`,
  closed: (a) => `${a}님이 PR을 닫았습니다`,
  reopened: (a) => `${a}님이 PR을 다시 열었습니다`,
  checkSuccess: () => 'CI 체크가 모두 성공했습니다',
  checkFailure: () => 'CI 체크가 실패했습니다',
  checkWarning: () => 'CI 체크에 경고가 있습니다',
};

// 타임라인 type 중 작성자만 확인하면 되는 단순 매핑이다.
const SIMPLE_TIMELINE_KINDS = new Map([
  ['comment', 'comment'],
  ['review', 'review'],
  ['code', 'review'],
  ['pull_push', 'pushed'],
  ['merge_pull', 'merged'],
  ['close', 'closed'],
  ['reopen', 'reopened'],
]);

const rankOf = (kind) => KIND_PRIORITY.indexOf(kind);

// 이벤트 종류를 설정의 알림 항목 키로 변환한다.
export function settingKeyOf(kind) {
  if (kind === 'closed' || kind === 'reopened') return 'closedReopened';
  if (kind.startsWith('check')) return 'checks';
  return kind;
}

export function eventsFromTimeline(timeline, { me, sinceMs, prUrl }) {
  const events = [];
  for (const ev of timeline ?? []) {
    if (!ev.user || ev.user.login === me) continue;
    if (Date.parse(ev.created_at) < sinceMs) continue;

    let kind = SIMPLE_TIMELINE_KINDS.get(ev.type);
    if (ev.type === 'review_request' || ev.type === 'assignees') {
      // 나를 지정한 경우만 대상이며, 지정 해제는 제외한다.
      if (ev.assignee?.login === me && !ev.removed_assignee) {
        kind = ev.type === 'review_request' ? 'reviewRequested' : 'assigned';
      }
    }
    if (!kind) continue;

    events.push({
      kind,
      key: `t:${ev.id}`,
      actor: ev.user.login,
      at: ev.created_at,
      url: ev.html_url || prUrl,
    });
  }
  return events;
}

export function newPullEvent(pull, { me, sinceMs, prKey }) {
  if (pull.user?.login === me) return null;
  if (!(Date.parse(pull.created_at) >= sinceMs)) return null;
  return {
    kind: 'newPull',
    key: `new:${prKey}`,
    actor: pull.user?.login ?? '',
    at: pull.created_at,
    url: pull.html_url,
  };
}

const TERMINAL_CHECK_STATES = new Set(['success', 'failure', 'warning']);

// 종료 상태로 새로 진입했을 때만 해당 상태를 반환한다. 기준선 억제는 호출자가 결정한다.
export function checkTransition(prev, next) {
  if (!TERMINAL_CHECK_STATES.has(next.state)) return null;
  if (!prev || prev.sha !== next.sha || prev.state !== next.state) return next.state;
  return null;
}

export function buildNotifications(groups, { baseUrl, maxGroups = 5 }) {
  const prepared = groups.map(({ pr, events }) => {
    const sorted = [...events].sort((a, b) => rankOf(a.kind) - rankOf(b.kind));
    return { pr, sorted, top: sorted[0] };
  });
  const headline = ({ pr, top }) => `${LABELS[top.kind]} · ${pr.owner}/${pr.repo} #${pr.number}`;

  if (prepared.length > maxGroups) {
    return [
      {
        url: `${baseUrl}/notifications`,
        title: `Gitea 새 소식 ${prepared.length}건`,
        message: prepared.slice(0, 3).map(headline).join('\n'),
        contextMessage: '알림을 누르면 Gitea 알림함이 열립니다',
      },
    ];
  }

  return prepared.map((group) => {
    const { pr, sorted, top } = group;
    const descriptions = [...new Set(sorted.map((ev) => DESCRIPTIONS[ev.kind](ev.actor)))];
    const rest = descriptions.length - 2;
    const contextMessage = descriptions.slice(0, 2).join(', ') + (rest > 0 ? ` 외 ${rest}건` : '');
    return {
      url: descriptions.length === 1 ? top.url : pr.url,
      title: headline(group),
      message: pr.title,
      contextMessage,
    };
  });
}

// 알림 id에 이동할 URL을 담아 두어 클릭 시 복원한다. 같은 URL이 겹치지 않도록 시각과 순번을 붙인다.
export function notificationId(url, i) {
  return `${url}${ID_MARKER}${Date.now()}-${i}`;
}

export function urlFromNotificationId(id) {
  const at = id.lastIndexOf(ID_MARKER);
  return at < 0 ? '' : id.slice(0, at);
}
