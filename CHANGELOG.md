# Changelog

이 프로젝트의 주요 변경 사항을 기록합니다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르고,
버전은 [유의적 버전](https://semver.org/lang/ko/)을 따릅니다.

릴리즈할 때는 `## [Unreleased]` 아래에 `## [x.y.z] - YYYY-MM-DD` 섹션을 추가하고 `extension/manifest.json`의 `version`을 같은 값으로 맞춥니다.
릴리즈 워크플로가 해당 버전 섹션을 GitHub Release 본문으로 사용합니다.

## [Unreleased]

## [1.0.1] - 2026-10-29

### Changed
- 릴리즈 첨부 파일 구성을 단일 확장 배포 파일 `gitea-pr-extension.zip`으로 변경하고 스토어 등록 자료 첨부 제외
- `README.md`: Releases에서 `gitea-pr-extension.zip`을 내려받아 확장 관리 페이지(`chrome://extensions`)에서 수동 설치하는 안내 추가
- `CONTRIBUTING.md`: 패키징 명령 및 릴리즈 절차 설명 갱신

## [1.0.0] - 2026-10-29

### Added
- 툴바 팝업에서 열린 PR을 리뷰 요청 · 내 PR · 담당 · 리뷰함 · 멘션 탭으로 나누어 표시
- PR 카드에 저장소, 브랜치, 작성자, 리뷰어, 담당자, 참여자, 리뷰 상태, CI 상태, 초안, 병합 가능 여부, 라벨, 마일스톤, 댓글 수, 변경 규모, 생성일, 최근 업데이트, 마감일 표시
- 설정 페이지: Gitea 주소와 토큰, 테마(시스템/라이트/다크), 탭 순서(끌어서 변경), 표시 항목 선택, 저장 전 실시간 미리보기
- 브라우저 알림(선택): 새 PR, 리뷰어·담당자 지정, 코멘트, 리뷰 제출, 새 커밋, 머지, 닫힘/다시 열림, 체크 상태 변경을 지정한 주기(1~60분)로 확인
- 입력한 Gitea 주소에 대해서만 런타임에 사이트 접근 권한을 요청
- 설치 없이 동작을 확인할 수 있는 HTML 미리보기와 시뮬레이터 (`npm run preview`)
- Chrome 웹 스토어 등록 자료: 개인정보처리방침(`PRIVACY.md`), 등록 문구와 권한 사유(`store/listing.md`), 스크린샷과 프로모션 타일(`store/screenshots/`)
- 릴리즈 PR(`release*` 브랜치) 머지 시 스토어 제출용 ZIP을 첨부한 GitHub Release를 만드는 워크플로
- Apache License 2.0
