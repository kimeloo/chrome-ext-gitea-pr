// Gitea REST API 클라이언트. status 0은 네트워크 오류 또는 타임아웃을 뜻한다.

const PAGE_SIZE = 50;
const MAX_PAGES = 4;
const TIMEOUT_MS = 15000;

export class ApiError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} ${url}`);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
  }
}

export class GiteaClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  async request(path, params = {}) {
    const query = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/api/v1${path}${query ? `?${query}` : ''}`;
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `token ${this.token}`, Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(0, url);
    }
    if (!res.ok) throw new ApiError(res.status, url);
    let data;
    try {
      // 본문 수신 중 타임아웃이나 JSON이 아닌 응답도 연결 실패로 취급한다.
      data = await res.json();
    } catch {
      throw new ApiError(0, url);
    }
    return { data, headers: res.headers };
  }

  async getCurrentUser() {
    const { data } = await this.request('/user');
    return data;
  }

  async searchPulls(param) {
    const items = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { data, headers } = await this.request('/repos/issues/search', {
        type: 'pulls',
        state: 'open',
        [param]: 'true',
        limit: String(PAGE_SIZE),
        page: String(page),
      });
      if (!Array.isArray(data) || data.length === 0) break;
      items.push(...data);
      const raw = headers.get('X-Total-Count');
      const total = raw === null || raw.trim() === '' ? NaN : Number(raw);
      // 서버의 최대 응답 개수가 50보다 작을 수 있으므로 총 개수가 있으면 그 값으로 종료를 판단한다.
      if (Number.isFinite(total) ? items.length >= total : data.length < PAGE_SIZE) break;
    }
    return items;
  }

  async getPull(owner, repo, index) {
    const { data } = await this.request(`/repos/${enc(owner)}/${enc(repo)}/pulls/${index}`);
    return data;
  }

  async listReviews(owner, repo, index) {
    const { data } = await this.request(`/repos/${enc(owner)}/${enc(repo)}/pulls/${index}/reviews`, {
      limit: String(PAGE_SIZE),
    });
    return data;
  }

  async getCombinedStatus(owner, repo, sha) {
    const { data } = await this.request(`/repos/${enc(owner)}/${enc(repo)}/commits/${enc(sha)}/status`, {
      limit: String(PAGE_SIZE),
    });
    return data;
  }

  async listComments(owner, repo, index) {
    const { data } = await this.request(`/repos/${enc(owner)}/${enc(repo)}/issues/${index}/comments`);
    return data;
  }

  // 서버 시각 기준으로 폴링 커서를 관리하기 위해 응답의 Date 헤더를 사용한다.
  // 알림 읽기 권한이 없으면 401/403이 그대로 전파되므로 권한 확인에도 쓰인다.
  async getServerTime() {
    const { headers } = await this.request('/notifications/new');
    return serverTimeOf(headers);
  }

  async listPullNotifications(sinceIso) {
    const { data, headers } = await this.request('/notifications', {
      'subject-type': 'pull',
      since: sinceIso,
      limit: String(PAGE_SIZE),
    });
    return { threads: data, serverTime: serverTimeOf(headers) };
  }

  async listTimeline(owner, repo, index, sinceIso) {
    const { data } = await this.request(`/repos/${enc(owner)}/${enc(repo)}/issues/${index}/timeline`, {
      since: sinceIso,
      limit: String(PAGE_SIZE),
    });
    return data;
  }
}

function enc(value) {
  return encodeURIComponent(value);
}

function serverTimeOf(headers) {
  const ms = Date.parse(headers.get('Date'));
  return Number.isNaN(ms) ? Date.now() : ms;
}

export function describeError(err) {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 0:
        return 'Gitea 서버에 연결할 수 없습니다. 주소와 네트워크(VPN 등)를 확인하세요.';
      case 401:
        return '토큰이 유효하지 않습니다. 설정에서 토큰을 확인하세요.';
      case 403:
        return '토큰 권한이 부족합니다. issue · notification · repository · user 읽기 권한이 필요합니다.';
      case 404:
        return 'Gitea API를 찾을 수 없습니다. 주소(하위 경로 포함)를 확인하세요.';
      default:
        return `Gitea 요청 실패 (HTTP ${err.status})`;
    }
  }
  return `알 수 없는 오류: ${err?.message ?? err}`;
}
