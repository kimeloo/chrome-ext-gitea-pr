// 탭별 PR 목록을 검색하고, 켜진 표시 항목에 필요한 상세 정보만 추가로 불러온다.

import { ApiError, GiteaClient } from './gitea.js';
import { collectParticipants, summarizeChecks, summarizeReviews, toUser } from './summarize.js';

export const TABS = [
  { key: 'reviewRequested', label: '리뷰 요청', desc: '나에게 리뷰가 요청된 PR', param: 'review_requested', empty: '리뷰를 요청받은 열린 PR이 없습니다.' },
  { key: 'created', label: '내 PR', desc: '내가 연 PR', param: 'created', empty: '내가 연 열린 PR이 없습니다.' },
  { key: 'assigned', label: '담당', desc: '나에게 할당된 PR', param: 'assigned', empty: '나에게 할당된 열린 PR이 없습니다.' },
  { key: 'reviewed', label: '리뷰함', desc: '내가 리뷰한 PR', param: 'reviewed', empty: '내가 리뷰한 열린 PR이 없습니다.' },
  { key: 'mentioned', label: '멘션', desc: '나를 멘션한 PR', param: 'mentioned', empty: '나를 멘션한 열린 PR이 없습니다.' },
];

const TAB_BY_KEY = new Map(TABS.map((t) => [t.key, t]));

// 알 수 없거나 중복된 키는 버리고, 빠진 탭은 기본 순서대로 뒤에 붙인다.
export function normalizeTabOrder(order) {
  const keys = new Set();
  if (Array.isArray(order)) for (const key of order) if (TAB_BY_KEY.has(key)) keys.add(key);
  for (const tab of TABS) keys.add(tab.key);
  return [...keys];
}

export function orderedTabs(order) {
  return normalizeTabOrder(order).map((key) => TAB_BY_KEY.get(key));
}

const DETAIL_CONCURRENCY = 4;
const PERMISSION_WARNING = 'PR 상세 정보 일부를 불러오지 못했습니다. 토큰에 repository 읽기 권한이 있는지 확인하세요.';

const keyOf = (issue) => `${issue.repository.full_name}#${issue.number}`;

// 상세 로드 전 필드는 undefined로 두며, undefined인 필드는 렌더링하지 않는다.
function fromIssue(issue) {
  return {
    key: keyOf(issue),
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    owner: issue.repository.owner,
    repo: issue.repository.name,
    author: toUser(issue.user),
    labels: (issue.labels ?? []).map((l) => ({ name: l.name, color: l.color })),
    milestone: issue.milestone
      ? { title: issue.milestone.title, dueOn: issue.milestone.due_on ?? null }
      : null,
    assignees: (issue.assignees ?? []).map(toUser),
    comments: issue.comments ?? 0,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    dueDate: issue.due_date ?? null,
    draft: issue.pull_request?.draft,
  };
}

function requiredResources(fields) {
  return {
    pull: Boolean(
      fields.baseBranch || fields.headBranch || fields.reviewers || fields.reviewStatus
        || fields.checks || fields.mergeable || fields.diffStat || fields.comments,
    ),
    reviews: Boolean(fields.reviewers || fields.reviewStatus || fields.participants),
    status: Boolean(fields.checks),
    comments: Boolean(fields.participants),
  };
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const timeOf = (iso) => Date.parse(iso) || 0;
const numberOrUndefined = (v) => (typeof v === 'number' ? v : undefined);

export async function loadDashboard({ baseUrl, token, fields }, { onSearched } = {}) {
  const client = new GiteaClient(baseUrl, token);
  // 검색은 하나라도 실패하면 전체 실패로 처리한다.
  const searched = await Promise.all(TABS.map((t) => client.searchPulls(t.param)));

  // 여러 탭에 나타나는 PR은 같은 객체를 공유하여 상세 정보를 한 번만 불러온다.
  const byKey = new Map();
  const tabs = {};
  TABS.forEach((tab, i) => {
    const seen = new Set();
    const list = [];
    for (const issue of searched[i]) {
      const key = keyOf(issue);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!byKey.has(key)) byKey.set(key, fromIssue(issue));
      list.push(byKey.get(key));
    }
    list.sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt));
    tabs[tab.key] = list;
  });

  onSearched?.({ baseUrl, fetchedAt: Date.now(), tabs, warning: null });

  const need = requiredResources(fields);
  let permissionDenied = false;

  const attempt = async (what, fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        permissionDenied = true;
      } else {
        console.warn(`${what} 로드 실패`, err);
      }
      return undefined;
    }
  };

  const enrich = async (pr) => {
    const { owner, repo, number, key } = pr;

    const [pull, reviews, comments] = await Promise.all([
      need.pull ? attempt(`${key} pull`, () => client.getPull(owner, repo, number)) : undefined,
      need.reviews ? attempt(`${key} reviews`, () => client.listReviews(owner, repo, number)) : undefined,
      need.comments ? attempt(`${key} comments`, () => client.listComments(owner, repo, number)) : undefined,
    ]);

    if (pull) {
      pr.baseBranch = pull.base?.ref;
      pr.headBranch = pull.head?.ref;
      pr.headSha = pull.head?.sha;
      // 병합 가능 여부가 아직 계산되지 않은 경우(null)는 표시하지 않는다.
      if (typeof pull.mergeable === 'boolean') pr.mergeable = pull.mergeable;
      pr.additions = numberOrUndefined(pull.additions);
      pr.deletions = numberOrUndefined(pull.deletions);
      pr.changedFiles = numberOrUndefined(pull.changed_files);
      pr.reviewComments = numberOrUndefined(pull.review_comments);
      pr.draft = pull.draft ?? pr.draft;
    }

    // pull과 reviews 중 하나라도 성공했을 때만 리뷰어를 계산한다.
    if ((fields.reviewers || fields.reviewStatus) && (pull || reviews)) {
      pr.reviewers = summarizeReviews({
        authorLogin: pr.author?.login,
        requested: pull?.requested_reviewers ?? [],
        reviews: reviews ?? [],
      });
    }

    // 커밋 상태 조회에는 pull에서 얻은 head sha가 필요하다.
    if (need.status && pr.headSha) {
      const combined = await attempt(`${key} status`, () => client.getCombinedStatus(owner, repo, pr.headSha));
      if (combined !== undefined) pr.checks = summarizeChecks(combined);
    }

    if (need.comments && comments) {
      pr.participants = collectParticipants({ author: pr.author, comments, reviews: reviews ?? [] });
    }
  };

  if (need.pull || need.reviews || need.status || need.comments) {
    await mapLimit([...byKey.values()], DETAIL_CONCURRENCY, enrich);
  }

  return {
    baseUrl,
    fetchedAt: Date.now(),
    tabs,
    warning: permissionDenied ? PERMISSION_WARNING : null,
  };
}
