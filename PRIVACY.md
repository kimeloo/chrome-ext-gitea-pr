# 개인정보처리방침 / Privacy Policy

최종 수정일: 2026-10-29

## 한국어

**Gitea PR Status**(이하 "확장 프로그램")는 사용자가 지정한 Gitea 서버에서 사용자와 관련된 Pull Request 현황을 가져와 툴바 팝업과 브라우저 알림으로 보여줍니다. 개발자는 사용자의 데이터를 수집하거나 개발자의 서버로 전송하지 않습니다.

### 처리하는 정보와 저장 위치
모든 정보는 사용자의 브라우저 안(`chrome.storage.local`)에만 저장되며, 크롬 동기화를 통해 다른 기기로 전송되지 않습니다.

| 정보 | 용도 |
|---|---|
| Gitea 서버 주소 | 요청을 보낼 서버 지정 |
| Gitea 액세스 토큰 | Gitea API 인증 (`Authorization` 헤더) |
| 표시·알림·테마 설정 | 사용자 설정 유지 |
| 마지막으로 조회한 PR 목록(캐시) | 팝업을 열 때 이전 결과를 먼저 표시 |
| 알림 확인 상태(마지막 확인 시각, 이미 알린 항목) | 같은 알림이 반복되지 않도록 함 |

### 외부 전송
- 확장 프로그램은 사용자가 설정에 입력한 Gitea 서버로만 요청을 보냅니다. 이 서버는 사용자가 직접 선택한 것이며, 요청에는 쿠키가 포함되지 않고(`credentials: omit`) 토큰만 인증에 사용됩니다.
- PR 목록에 표시되는 사용자 아바타 이미지는 Gitea가 응답한 `avatar_url`에서 불러옵니다. 해당 주소는 Gitea 서버 또는 Gitea가 연동한 외부 서비스(예: Gravatar)일 수 있으며, 요청에는 리퍼러가 포함되지 않습니다.
- 개발자 서버, 분석·통계 도구, 광고, 외부 CDN, 원격 코드는 사용하지 않습니다.
- 데이터를 제3자에게 판매하거나 제공하지 않으며, 확장 프로그램의 단일 목적(Gitea PR 현황 표시) 외의 용도로 사용하지 않습니다.

### 요청하는 권한
| 권한 | 사유 |
|---|---|
| `storage` | 설정, 캐시, 알림 확인 상태를 브라우저에 저장 |
| `alarms` | 알림을 켠 경우 지정한 주기로 Gitea를 확인 |
| `notifications` | PR 소식을 운영체제 알림으로 표시 |
| 선택적 사이트 접근 권한 | 사용자가 입력한 Gitea 서버 주소(해당 출처만)에 API 요청. 설정 저장 시 크롬이 허용 여부를 묻습니다 |

### 데이터 삭제
- 설정 페이지에서 Gitea 주소를 변경하면 캐시와 알림 상태가 초기화되고 이전 서버에 대한 사이트 접근 권한이 해제됩니다.
- 확장 프로그램을 제거하면 저장된 모든 데이터가 삭제됩니다.
- Gitea 서버에서 발급한 토큰은 Gitea의 **설정 → 애플리케이션**에서 언제든 폐기할 수 있습니다.

### 문의
[GitHub Issues](https://github.com/kimeloo/chrome-ext-gitea-pr/issues)로 문의해 주세요.

---

## English

**Gitea PR Status** (the "Extension") fetches pull requests related to you from the Gitea server you specify and shows them in a toolbar popup and in browser notifications. The developer does not collect your data and does not send it to any server operated by the developer.

### Data handled and where it is stored
Everything is stored only inside your browser (`chrome.storage.local`). It is not synced to other devices through Chrome Sync.

| Data | Purpose |
|---|---|
| Gitea server URL | Choose the server to send requests to |
| Gitea access token | Authenticate with the Gitea API (`Authorization` header) |
| Display, notification and theme settings | Keep your preferences |
| Last fetched pull request list (cache) | Show the previous result immediately when the popup opens |
| Notification state (last check time, items already notified) | Avoid duplicate notifications |

### Network requests
- The Extension only sends requests to the Gitea server you enter in the settings. Requests carry no cookies (`credentials: omit`); only the token is used for authentication.
- User avatar images are loaded from the `avatar_url` returned by Gitea. It may point to your Gitea server or to an external service Gitea is configured to use (for example Gravatar). No referrer is sent.
- No developer-operated server, analytics, advertising, external CDN or remote code is used.
- Your data is never sold or shared with third parties, and it is used only for the Extension's single purpose: showing Gitea pull request status.

### Permissions
| Permission | Reason |
|---|---|
| `storage` | Save settings, cache and notification state in the browser |
| `alarms` | Check Gitea periodically when notifications are enabled |
| `notifications` | Show pull request updates as system notifications |
| Optional host access | API requests to the Gitea origin you enter (that origin only). Chrome asks for your approval when you save the settings |

### Deleting data
- Changing the Gitea URL in the settings clears the cache and notification state and revokes host access for the previous server.
- Uninstalling the Extension deletes all stored data.
- You can revoke the token at any time in Gitea under **Settings → Applications**.

### Contact
Please open an issue at [GitHub Issues](https://github.com/kimeloo/chrome-ext-gitea-pr/issues).
