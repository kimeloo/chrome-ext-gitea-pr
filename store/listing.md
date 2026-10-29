# Chrome 웹 스토어 등록 자료

개발자 대시보드(https://chrome.google.com/webstore/devconsole)의 각 입력란에 그대로 붙여 넣을 수 있도록 정리한 문서입니다.
릴리즈 때 `store-assets-v{version}.zip`으로 GitHub Release에 함께 첨부됩니다.

## 스토어 등록정보

| 항목 | 값 |
|---|---|
| 카테고리 | 개발자 도구 (Developer Tools) |
| 공개 범위 | Public |
| 개인정보처리방침 URL | https://github.com/kimeloo/chrome-ext-gitea-pr/blob/HEAD/PRIVACY.md |
| 홈페이지 URL | https://github.com/kimeloo/chrome-ext-gitea-pr |
| 지원 URL | https://github.com/kimeloo/chrome-ext-gitea-pr/issues |
| 아이콘 | `extension/icons/icon128.png` (ZIP에 포함됨) |
| 스크린샷 (1280×800) | `store/screenshots/01-popup.png`, `store/screenshots/02-settings.png` |
| 소형 프로모션 타일 (440×280) | `store/screenshots/promo-tile-440x280.png` |

## 한국어

**이름**: Gitea PR Status

**요약** (132자 이내):
내 리뷰 요청·내 PR·담당·리뷰함·멘션 PR을 툴바 팝업과 브라우저 알림으로 확인하는 Gitea 전용 확장 프로그램

**자세한 설명**:
```
Gitea의 Pull Request 화면을 매번 열지 않고, 툴바 아이콘 하나로 나와 관련된 PR을 확인하세요.

■ 다섯 가지 탭
- 리뷰 요청: 나에게 리뷰가 요청된 PR
- 내 PR: 내가 연 PR
- 담당: 나에게 할당된 PR
- 리뷰함: 내가 리뷰한 PR
- 멘션: 나를 멘션한 PR
탭 순서는 설정에서 끌어서 바꿀 수 있습니다.

■ 한눈에 보이는 PR 정보
저장소, 브랜치, 작성자, 리뷰어, 리뷰 상태(승인/변경 요청/대기), CI 상태, 초안 여부, 병합 가능 여부(충돌), 라벨, 마일스톤, 댓글 수, 변경 규모(+/− 줄), 생성일, 최근 업데이트, 마감일. 필요 없는 항목은 설정에서 끌 수 있고, 저장 전에 미리보기로 팝업 모양을 확인할 수 있습니다.

■ 브라우저 알림 (선택)
새 PR, 리뷰어/담당자 지정, 코멘트, 리뷰 제출, 새 커밋, 머지, 닫힘/다시 열림, CI 체크 상태 변경을 1~60분 주기로 확인해 알려줍니다. 알림을 누르면 해당 PR이 새 탭으로 열립니다. 기본값은 꺼짐입니다.

■ 개인정보 보호
- 설정과 토큰은 이 브라우저(chrome.storage.local)에만 저장되며 동기화되지 않습니다.
- 요청은 사용자가 입력한 Gitea 서버로만 전송됩니다. 개발자 서버, 분석 도구, 광고, 외부 CDN을 사용하지 않습니다.
- 사이트 접근 권한은 입력한 Gitea 주소에 대해서만 크롬이 허용 여부를 물어봅니다.

■ 사용 방법
1. Gitea → 프로필 → 설정 → 애플리케이션에서 토큰 생성 (issue, notification, repository, user 읽기 권한)
2. 확장 프로그램 설정 페이지에 Gitea 주소와 토큰 입력 후 저장, 사이트 접근 허용
3. 툴바 아이콘을 눌러 확인

Gitea 1.22 이상을 기준으로 합니다. 오픈소스(Apache-2.0): https://github.com/kimeloo/chrome-ext-gitea-pr
```

## English

**Name**: Gitea PR Status

**Summary** (≤132 chars):
See the Gitea pull requests that need you — review requests, yours, assigned, reviewed, mentioned — in a toolbar popup.

**Detailed description**:
```
Stop opening Gitea's pull request page over and over. Check every PR related to you from one toolbar icon.

TABS
- Review requested: PRs waiting for your review
- Mine: PRs you opened
- Assigned: PRs assigned to you
- Reviewed: PRs you reviewed
- Mentioned: PRs that mention you
You can reorder the tabs in the settings by dragging.

PR DETAILS AT A GLANCE
Repository, branches, author, reviewers, review status (approved / changes requested / pending), CI status, draft, mergeability (conflicts), labels, milestone, comment count, diff size (+/- lines), created and updated time, due date. Turn off anything you don't need and check the result in a live preview before saving.

BROWSER NOTIFICATIONS (OPTIONAL)
Get notified about new PRs, review/assignee requests, comments, submitted reviews, new commits, merges, close/reopen and CI check changes, checked every 1 to 60 minutes. Clicking a notification opens the PR in a new tab. Off by default.

PRIVACY
- Settings and your token are stored only in this browser (chrome.storage.local) and are never synced.
- Requests go only to the Gitea server you enter. No developer server, analytics, ads or external CDN.
- Chrome asks for site access only for the Gitea address you enter.

GETTING STARTED
1. In Gitea: Profile → Settings → Applications → create a token with read access to issue, notification, repository and user
2. Open the extension settings, enter your Gitea URL and token, save, and allow site access
3. Click the toolbar icon

Built for Gitea 1.22 or later. Open source (Apache-2.0): https://github.com/kimeloo/chrome-ext-gitea-pr
```

## 단일 목적 (Single purpose)

사용자가 지정한 Gitea 서버에서 사용자와 관련된 Pull Request 현황을 가져와 툴바 팝업과 브라우저 알림으로 보여준다.

## 권한 사유 (Permission justification)

| 권한 | 입력할 사유 |
|---|---|
| `storage` | Gitea 주소·토큰·표시 설정, 마지막 조회 결과 캐시, 알림 확인 상태를 chrome.storage.local에 저장하기 위해 필요합니다. |
| `alarms` | 사용자가 알림을 켠 경우 지정한 주기(1~60분)마다 Gitea의 새 소식을 확인하기 위해 필요합니다. |
| `notifications` | PR의 새 소식을 운영체제 알림으로 보여주기 위해 필요합니다. |
| 선택적 호스트 권한 (`https://*/*`, `http://*/*`) | Gitea는 사용자마다 서버 주소가 달라 사전에 도메인을 알 수 없습니다. 설치 시에는 어떤 사이트 권한도 요구하지 않으며, 사용자가 설정에 입력한 Gitea 주소의 출처 하나에 대해서만 `chrome.permissions.request`로 런타임에 허용을 받습니다. 주소를 바꾸면 이전 출처의 권한은 해제합니다. |

- 원격 코드 사용: **아니요**. 모든 코드는 패키지에 포함되어 있으며 `eval`, 외부 스크립트, 외부 CDN을 사용하지 않습니다.

## 개인정보 보호 관행 (Privacy practices 탭)

| 항목 | 선택 |
|---|---|
| 수집하는 사용자 데이터 | **인증 정보** (Gitea 액세스 토큰). 브라우저 로컬에만 저장하며 개발자에게 전송하지 않음 |
| 그 외 데이터 유형 (개인 식별 정보, 위치, 웹 기록, 사용자 활동 등) | 수집하지 않음 |
| 승인 용도 외 판매·전송 | 하지 않음 |
| 단일 목적과 무관한 사용 | 하지 않음 |
| 신용 판단·대출 목적 사용 | 하지 않음 |

세 가지 인증 항목(판매 안 함 / 무관한 목적에 사용 안 함 / 신용 판단에 사용 안 함)에 모두 동의합니다.

## 심사자 안내 (Test instructions)

```
이 확장 프로그램은 사용자의 Gitea 서버가 있어야 동작합니다. 공개 데모 계정이 없어 아래 방법으로 확인할 수 있습니다.

1. 설치 후 자동으로 열리는 설정 페이지에서 Gitea 주소와 토큰을 입력하고 저장하면, 크롬이 해당 주소에 대한 사이트 접근 허용을 묻습니다. 설치 시점에는 어떤 사이트 권한도 요구하지 않습니다.
2. Gitea 서버가 없는 경우, 저장소의 미리보기 시뮬레이터(npm run preview, https://github.com/kimeloo/chrome-ext-gitea-pr)로 가짜 Gitea 응답을 사용해 팝업·설정·알림 동작을 확인할 수 있습니다.
3. 확장은 입력된 Gitea 주소 외의 어떤 서버로도 요청을 보내지 않습니다.
```
