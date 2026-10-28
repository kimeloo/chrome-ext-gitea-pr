// 설정 페이지 좌측 메뉴: 빠른 부드러운 스크롤 이동과 현재 위치 강조(scroll-spy)를 담당한다.
const MIN_DURATION = 160;
const MAX_DURATION = 320;
const BASE_DURATION = 120;
const MS_PER_PX = 0.12;
// 가로 메뉴 바 아래로 두는 여백과 세로 메뉴일 때의 여백. options.css의 scroll-margin-top과 같아야 한다.
const BAR_GAP = 12;
const SIDE_GAP = 16;
// 섹션 상단이 기준선에서 이만큼 아래에 있어도 현재 섹션으로 본다.
const SPY_SLACK = 24;
const PIN_TOLERANCE = 2;
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'];

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const clamp = (min, value, max) => Math.min(max, Math.max(min, value));

export function initSideNav(navEl) {
  if (!navEl) return;

  const scroller = document.scrollingElement;
  const list = navEl.querySelector('ol');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const entries = [...navEl.querySelectorAll('a[href^="#"]')].map((link) => ({
    link,
    section: document.getElementById(decodeURIComponent(link.hash.slice(1))),
  }));
  const found = entries.filter((entry) => entry.section);

  let animFrame = 0;
  let spyFrame = 0;
  let activeLink = null;
  // 클릭으로 이동한 섹션은 스크롤 위치가 바뀌기 전까지 활성으로 고정한다. 페이지 끝에서 도달하지 못한 섹션도 유지하기 위함이다.
  let pinned = null;
  let pinnedY = 0;

  // 메뉴가 가로 바일 때만 스크롤 기준선에 바의 높이가 더해진다.
  const isHorizontal = () => getComputedStyle(list).flexDirection === 'row';
  const getOffset = () => (isHorizontal() ? navEl.getBoundingClientRect().height + BAR_GAP : SIDE_GAP);

  function setActive(link) {
    if (link === activeLink) return;
    activeLink = link;
    for (const entry of entries) {
      const on = entry.link === link;
      entry.link.classList.toggle('active', on);
      if (on) entry.link.setAttribute('aria-current', 'true');
      else entry.link.removeAttribute('aria-current');
    }
    if (link && isHorizontal()) revealInBar(link);
  }

  // 가로 바가 넘칠 때 활성 항목이 보이도록 바 안에서만 스크롤한다. 페이지 스크롤에는 영향이 없다.
  function revealInBar(link) {
    const left = link.offsetLeft;
    const right = left + link.offsetWidth;
    if (left >= navEl.scrollLeft && right <= navEl.scrollLeft + navEl.clientWidth) return;
    navEl.scrollLeft = left - (navEl.clientWidth - link.offsetWidth) / 2;
  }

  function findCurrent() {
    if (!found.length) return null;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (maxScroll > 0 && scroller.scrollTop >= maxScroll - 1) return found[found.length - 1].link;

    const line = getOffset() + SPY_SLACK;
    let current = found[0];
    for (const entry of found) {
      if (entry.section.getBoundingClientRect().top <= line) current = entry;
    }
    return current.link;
  }

  function updateSpy() {
    spyFrame = 0;
    if (pinned && !animFrame && Math.abs(scroller.scrollTop - pinnedY) > PIN_TOLERANCE) pinned = null;
    setActive(pinned ?? findCurrent());
  }

  function scheduleSpy() {
    if (!spyFrame) spyFrame = requestAnimationFrame(updateSpy);
  }

  function cancelScroll() {
    if (!animFrame) return;
    cancelAnimationFrame(animFrame);
    animFrame = 0;
    pinned = null;
    scheduleSpy();
  }

  function arrive(entry) {
    const heading = entry.section.querySelector('h2');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    pinnedY = scroller.scrollTop;
    scheduleSpy();
  }

  function scrollToEntry(entry) {
    cancelScroll();
    pinned = entry.link;
    setActive(entry.link);

    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    const to = clamp(0, entry.section.getBoundingClientRect().top + scroller.scrollTop - getOffset(), maxScroll);
    const from = scroller.scrollTop;
    const distance = to - from;

    if (reducedMotion.matches || Math.abs(distance) < 1) {
      scroller.scrollTo({ top: to, behavior: 'instant' });
      arrive(entry);
      return;
    }

    const duration = clamp(MIN_DURATION, BASE_DURATION + Math.abs(distance) * MS_PER_PX, MAX_DURATION);
    let startTime;
    const step = (now) => {
      startTime ??= now;
      const t = Math.min(1, (now - startTime) / duration);
      scroller.scrollTo({ top: from + distance * easeOutCubic(t), behavior: 'instant' });
      if (t < 1) {
        animFrame = requestAnimationFrame(step);
        return;
      }
      animFrame = 0;
      arrive(entry);
    };
    animFrame = requestAnimationFrame(step);
  }

  function onClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;
    e.preventDefault();
    const entry = found.find((item) => item.link === link);
    if (entry) scrollToEntry(entry);
  }

  navEl.addEventListener('click', onClick);
  for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, cancelScroll, { passive: true });
  window.addEventListener('scroll', scheduleSpy, { passive: true });
  window.addEventListener('resize', scheduleSpy);
  updateSpy();
}
