# 기여 가이드

Gitea PR Status에 관심을 가져 주셔서 감사합니다. 이 문서는 개발에 참여하는 분들을 위한 안내입니다.
사용 방법은 [README](README.md)를 참고하세요.

## 기술 스택

- JavaScript (ES Modules), HTML, CSS
- Chrome Extension Manifest V3, 프레임워크와 빌드 단계 없음
- 저장소: `chrome.storage.local` (설정, 마지막 조회 결과 캐시, 알림 확인 상태)
- 테스트: Node.js 18+ (`node:test`)
- CI/CD: GitHub Actions (`release*` 브랜치 PR 머지 시 GitHub Release 생성)

## 디렉토리 구조

```
extension/                 ------ 압축해제 로드 대상 폴더
├── manifest.json          ------ 확장 매니페스트 (MV3)
├── background.js          ------ 설치 시 설정 페이지 열기, 알림 확인 주기(alarm) 관리
├── theme.js               ------ 테마 즉시 적용 (깜빡임 방지)
├── common.css             ------ 테마 변수, 팝업·미리보기 공용 스타일
├── popup.html/css/js      ------ 툴바 팝업
├── options.html/css/js    ------ 설정 페이지 (실시간 미리보기 포함)
├── icons/                 ------ 확장 아이콘
└── src/
    ├── settings.js        ------ 설정 기본값, 표시 항목 정의, 저장/불러오기
    ├── gitea.js           ------ Gitea REST API 클라이언트, 오류 메시지
    ├── notify.js          ------ 알림 이벤트 분류·문구 구성
    ├── poller.js          ------ 주기적 알림 확인과 확인 상태 저장
    ├── summarize.js       ------ 리뷰 상태·CI 상태·참여자 집계
    ├── dashboard.js       ------ 탭별 PR 조회와 상세 정보 수집
    ├── render.js          ------ PR 카드·탭 렌더링
    ├── icons.js           ------ Octicons SVG
    └── preview-data.js    ------ 설정 미리보기용 예시 데이터
preview/                   ------ HTML 미리보기 생성기 (가짜 크롬 화면, chrome.* 대체 구현, 가짜 Gitea)
test/                      ------ node:test 단위 테스트
scripts/package.sh         ------ 스토어 제출용 ZIP 생성
store/                     ------ 스토어 등록 자료
.github/workflows/         ------ 릴리즈 워크플로
```

## 개발 환경

1. Chrome(또는 Chromium 계열 브라우저)과 Node.js 18 이상을 준비합니다. Node.js는 테스트와 HTML 미리보기에만 필요합니다.
2. README의 설치 방법대로 `extension` 폴더를 압축해제로 로드합니다.
3. 코드를 수정한 뒤에는 `chrome://extensions`에서 확장의 새로고침 버튼을 누릅니다.

| 명령 | 설명 |
|---|---|
| `npm test` | 단위 테스트 |
| `npm run preview` | `dist/gitea-pr-status-preview.html` 생성 (생성 시점의 스냅샷) |
| `npm run preview:serve` | 로컬 미리보기 서버 실행 (기본 `http://127.0.0.1:4173/`) |
| `npm run package` | 스토어 제출용 ZIP을 `dist/`에 생성 |

## HTML 미리보기(시뮬레이터)

확장을 설치하지 않고도 팝업·설정·알림을 조작해 볼 수 있는 수동 테스트용 페이지입니다.

- `npm run preview`는 코드가 모두 포함된 HTML 파일 하나를 만듭니다. 코드를 수정할 때마다 다시 실행해야 합니다.
- `npm run preview:serve`는 요청마다 다시 빌드하므로 새로고침만 하면 됩니다. `preview/build.mjs`와 `preview/serve.mjs`를 수정했다면 서버를 다시 실행합니다. 종료는 `Ctrl+C`입니다.
- 크롬이 `file://`을 열지 못해 `ERR_ACCESS_DENIED`가 나오면 `preview:serve`를 사용합니다.
- 확장의 실제 코드(`extension/`)를 그대로 실행하되 `chrome.*` API와 Gitea 응답만 가짜로 대체합니다. 어떤 주소를 입력해도 예시 데이터를 사용합니다.
- 오른쪽 시뮬레이터 패널에서 서버 상태(응답 없음·느린 응답·토큰 오류) 전환, 이벤트 생성(코멘트·리뷰·머지·체크 결과 등), 알림 즉시 확인, 초기화를 할 수 있습니다.
- 설정과 예시 데이터는 `localStorage`에 저장됩니다. `preview/mock-gitea.js`나 설정 기본값을 바꿨다면 **처음 설치 상태로 되돌리기**를 눌러야 반영됩니다.
- 서비스 워커 수명, 실제 권한 창, 운영체제 알림, 실제 Gitea 서버의 응답은 확장을 설치해서 확인해야 합니다.

## Gitea API

REST API v1을 `Authorization: token {토큰}` 헤더로 호출합니다. Gitea 1.22 이상 기준이며, 초안·변경 규모·코드 리뷰 댓글 수는 1.22부터 제공됩니다.

| API | 용도 | 토큰 권한 |
|---|---|---|
| `GET /api/v1/user` | 연결 확인 | `read:user` |
| `GET /api/v1/repos/issues/search` | 탭별 열린 PR 목록 | `read:issue` |
| `GET /api/v1/repos/{owner}/{repo}/pulls/{index}` | 브랜치, 병합 가능 여부, 변경 규모, 리뷰 요청 대상 | `read:repository` |
| `GET /api/v1/repos/{owner}/{repo}/pulls/{index}/reviews` | 리뷰 상태 | `read:repository` |
| `GET /api/v1/repos/{owner}/{repo}/commits/{sha}/status` | CI 상태, 체크 상태 알림 | `read:repository` |
| `GET /api/v1/repos/{owner}/{repo}/issues/{index}/comments` | 참여자 | `read:issue` |
| `GET /api/v1/notifications/new` | 알림 권한 확인, 서버 시각 기준점 | `read:notification` |
| `GET /api/v1/notifications` | 알림 대상 PR 변경 확인 (주기마다 1건) | `read:notification` |
| `GET /api/v1/repos/{owner}/{repo}/issues/{index}/timeline` | 바뀐 PR의 코멘트·리뷰·머지 등 이벤트 | `read:issue` |

- 꺼져 있는 표시 항목·알림 항목에 필요한 API는 호출하지 않습니다.
- 알림 확인 요청 수: 바뀐 것이 없으면 주기마다 1건, 바뀐 PR마다 1~2건, 체크 상태 알림을 켜면 1건 + 내가 연 열린 PR 수 × 2건이 추가됩니다.
- Gitea REST API가 PR의 프로젝트(Projects) 정보를 제공하지 않아 프로젝트 항목은 지원하지 않습니다.

## 알림 기준

Gitea 알림함을 기준으로 하며, 이미 읽은 알림과 본인이 한 행동은 알리지 않습니다. 확인에 실패하면 다음 주기에 다시 시도합니다. 한 번에 6개 이상의 PR에 소식이 있으면 요약 알림 1건으로 묶습니다.

## 릴리즈 절차

1. `release/x.y.z`처럼 `release`로 시작하는 브랜치를 만듭니다.
2. `extension/manifest.json`의 `version`을 `x.y.z`로 올리고, `CHANGELOG.md`의 `## [Unreleased]`를 `## [x.y.z] - YYYY-MM-DD`로 바꿉니다. 필요하면 위에 새 `## [Unreleased]`를 추가합니다.
3. PR을 만들어 머지합니다.
4. 머지되면 `.github/workflows/release.yml`이 테스트를 실행한 뒤 태그 `vx.y.z`로 GitHub Release를 만들고 다음 파일을 첨부합니다. 릴리즈 본문은 `CHANGELOG.md`의 해당 버전 섹션입니다.
   - `gitea-pr-status-vx.y.z.zip`: Chrome 웹 스토어에 업로드할 패키지
   - `store-assets-vx.y.z.zip`: 개인정보처리방침, 등록 문구·권한 사유(`store/listing.md`), 스크린샷, 프로모션 타일
5. [개발자 대시보드](https://chrome.google.com/webstore/devconsole)에서 ZIP을 업로드하고 `store/listing.md`의 내용을 붙여 넣어 심사를 제출합니다. 스토어 업로드는 수동입니다.

스토어 스크린샷은 1280×800, 프로모션 타일은 440×280입니다.

## 기여 시 참고

- 스크린샷, 테스트 데이터, 이슈 내용에 실제 서버 주소·토큰·계정 정보가 들어가지 않도록 주의해 주세요. 예시에는 `gitea.example.com`, `acme/web` 같은 가상의 값을 사용합니다.
- 변경 사항은 `CHANGELOG.md`의 `## [Unreleased]`에 기록합니다.
- PR을 올리기 전에 `npm test`가 통과하는지 확인해 주세요.
