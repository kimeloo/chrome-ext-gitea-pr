// 시작 탭과 시뮬레이터 상단에서 같은 사용 순서를 보여 주기 위한 목록이다.
// 고정 문자열만 사용하므로 innerHTML로 넣어도 안전하다.

const STEPS = [
  '<b>설정에 예시 값 입력</b> 또는 아무 주소·토큰을 입력하고 저장 → 권한 허용',
  '툴바의 확장 아이콘을 눌러 팝업 확인',
  '설정에서 알림을 켜고 저장 → 이벤트 만들기 → <b>지금 확인</b>',
];

export function createHowto() {
  const list = document.createElement('ol');
  list.className = 'howto';
  list.innerHTML = STEPS.map((html) => `<li>${html}</li>`).join('');
  return list;
}
