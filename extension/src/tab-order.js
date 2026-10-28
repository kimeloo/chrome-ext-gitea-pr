// 팝업 탭 순서 목록. 핸들을 끌거나 키보드로 순서를 바꾼다.

import { TABS, normalizeTabOrder } from './dashboard.js';
import { ICONS } from './icons.js';

const SHIFT_MS = 150;
const SETTLE_MS = 120;
const EASING = 'cubic-bezier(0.2, 0, 0, 1)';
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function animateFrom(element, deltaY, duration) {
  if (!deltaY || REDUCED_MOTION.matches) return null;
  return element.animate(
    [{ transform: `translateY(${deltaY}px)` }, { transform: 'translateY(0)' }],
    { duration, easing: EASING },
  );
}

export function createTabOrderList(listEl, { order, onChange }) {
  const rows = new Map(); // 탭 key -> <li>
  const live = create('span', 'sr-only');
  live.setAttribute('aria-live', 'polite');
  listEl.after(live);

  let drag = null; // 진행 중인 드래그 상태

  const currentOrder = () => [...listEl.children].map((li) => li.dataset.tab);

  function updateIndexes() {
    [...listEl.children].forEach((li, i) => {
      li.querySelector('.tab-order-index').textContent = String(i + 1);
    });
  }

  function announce(tab, position) {
    live.textContent = `${tab.label}, ${rows.size}개 중 ${position}번째`;
  }

  // 행을 옮기기 전후의 화면 위치 차이만큼 되돌려 놓고 제자리로 미끄러지게 한다(FLIP).
  function flip(targets, mutate) {
    const tops = targets.map((el) => el.getBoundingClientRect().top);
    for (const el of targets) el.getAnimations().forEach((a) => a.cancel());
    mutate();
    targets.forEach((el, i) => animateFrom(el, tops[i] - el.getBoundingClientRect().top, SHIFT_MS));
  }

  // 이웃 행을 반대편으로 옮겨 순서를 바꾼다. 포커스와 포인터 캡처를 가진 행은 DOM에서 떼지 않는다.
  function passOver(row, neighbour) {
    if (neighbour === row.nextElementSibling) listEl.insertBefore(neighbour, row);
    else listEl.insertBefore(neighbour, row.nextElementSibling);
  }

  function buildRow(tab) {
    const li = create('li', 'tab-order-item');
    li.dataset.tab = tab.key;

    const text = create('span', 'tab-order-text');
    text.append(create('span', 'tab-order-label', tab.label), create('span', 'tab-order-desc', tab.desc));

    const handle = create('button', 'icon-btn drag-handle');
    handle.type = 'button';
    handle.setAttribute('aria-label', `${tab.label} 순서 변경`);
    handle.title = '끌어서 순서 변경';
    // ICONS는 정적 상수이므로 innerHTML로 넣어도 안전하다.
    handle.innerHTML = ICONS.threeBars;

    li.append(create('span', 'tab-order-index'), text, handle);

    handle.addEventListener('pointerdown', (e) => startDrag(e, li, handle));
    handle.addEventListener('pointermove', (e) => moveDrag(e, handle));
    handle.addEventListener('pointerup', (e) => endDrag(e, handle, true));
    handle.addEventListener('pointercancel', (e) => endDrag(e, handle, false));
    handle.addEventListener('lostpointercapture', (e) => endDrag(e, handle, false));
    handle.addEventListener('keydown', (e) => moveByKey(e, li, tab));
    return li;
  }

  function startDrag(e, row, handle) {
    if (drag || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    row.getAnimations().forEach((a) => a.cancel());
    drag = {
      row,
      handle,
      pointerId: e.pointerId,
      startY: e.clientY,
      startTop: row.offsetTop,
      translate: 0,
      startOrder: currentOrder(),
    };
    handle.setPointerCapture(e.pointerId);
    row.classList.add('dragging');
    listEl.classList.add('is-sorting');
  }

  function moveDrag(e, handle) {
    if (!drag || drag.handle !== handle || e.pointerId !== drag.pointerId) return;
    const { row } = drag;
    // offsetTop은 transform의 영향을 받지 않으므로 포인터 이동량에서 현재 배치 위치를 뺀 값이 이동 거리다.
    // 화면 표시는 목록 안으로 제한하지만, 순서 판단은 제한 전 위치로 하여 목록 끝 너머로 끌면 맨 앞·맨 뒤로 갈 수 있게 한다.
    let pointerShift = 0;
    const place = () => {
      pointerShift = drag.startTop + (e.clientY - drag.startY) - row.offsetTop;
      const min = -row.offsetTop;
      const max = listEl.clientHeight - row.offsetHeight - row.offsetTop;
      drag.translate = clamp(pointerShift, min, max);
      row.style.transform = `translateY(${drag.translate}px)`;
    };
    place();

    // 한 번의 이동으로 여러 칸을 지나갈 수 있으므로 더 이상 넘을 이웃이 없을 때까지 반복한다.
    for (;;) {
      const center = row.offsetTop + row.offsetHeight / 2 + pointerShift;
      const next = row.nextElementSibling;
      const prev = row.previousElementSibling;
      let neighbour = null;
      if (next && center > next.offsetTop + next.offsetHeight / 2) neighbour = next;
      else if (prev && center < prev.offsetTop + prev.offsetHeight / 2) neighbour = prev;
      if (!neighbour) break;
      flip([neighbour], () => passOver(row, neighbour));
      updateIndexes();
      place();
    }
  }

  function endDrag(e, handle, commit) {
    if (!drag || drag.handle !== handle || e.pointerId !== drag.pointerId) return;
    finishDrag(commit);
  }

  // commit이 아니면(취소·캡처 상실) 끌기 전 순서로 되돌린다.
  function finishDrag(commit) {
    const { row, handle, pointerId, translate, startOrder } = drag;
    drag = null;
    listEl.classList.remove('is-sorting');
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    row.style.transform = '';

    if (!commit) {
      for (const el of listEl.children) el.getAnimations().forEach((a) => a.cancel());
      const hadFocus = document.activeElement === handle;
      listEl.append(...startOrder.map((key) => rows.get(key)));
      if (hadFocus) handle.focus();
      row.classList.remove('dragging');
      updateIndexes();
      return;
    }

    const settle = animateFrom(row, translate, SETTLE_MS);
    if (settle) {
      const done = () => {
        if (drag?.row !== row) row.classList.remove('dragging');
      };
      settle.onfinish = done;
      settle.oncancel = done;
    } else {
      row.classList.remove('dragging');
    }

    const next = currentOrder();
    if (next.join() !== startOrder.join()) onChange?.(next);
  }

  function moveByKey(e, row, tab) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    if (drag) return;
    const neighbour = e.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
    if (neighbour) {
      flip([row, neighbour], () => passOver(row, neighbour));
      updateIndexes();
    }
    announce(tab, currentOrder().indexOf(tab.key) + 1);
    if (neighbour) onChange?.(currentOrder());
  }

  for (const tab of TABS) rows.set(tab.key, buildRow(tab));

  function render(next) {
    listEl.replaceChildren(...normalizeTabOrder(next).map((key) => rows.get(key)));
    updateIndexes();
  }

  render(order);

  return {
    getOrder: currentOrder,
    setOrder(next) {
      if (drag) finishDrag(false);
      for (const el of listEl.children) el.getAnimations().forEach((a) => a.cancel());
      render(next);
    },
  };
}
