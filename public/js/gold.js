// Visual-only behaviour for ui.css. It never calls the app's functions or
// touches data: it adds CSS classes and scrolls. Delete it and the app still works.

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Sections marked [data-reveal] stay visible unless this script is running.
document.documentElement.classList.add('reveal-ready');

// 1. Fade sections up as they scroll into view. A section is revealed once its
// top passes the bottom of the screen, so one that is scrolled past quickly is
// never left hidden (a plain IntersectionObserver can miss it on slow machines).
const pending = new Set(document.querySelectorAll('[data-reveal]'));
function reveal() {
  const limit = window.innerHeight - 40;
  for (const el of pending) {
    if (reduce || el.getBoundingClientRect().top < limit) {
      el.classList.add('is-visible');
      pending.delete(el);
    }
  }
}

// 2. Section tabs: the tab for the section in view is the dark (active) one.
// Only sections in the main flow are tracked; the allocator sits in the sidebar
// beside the ranking, so its tab lights up when clicked rather than on scroll.
const tabs = [...document.querySelectorAll('.tabs .tab')];
const targets = tabs.map((t) => document.querySelector(t.getAttribute('href')));
let holdUntil = 0;
function setTab(active) {
  tabs.forEach((t, i) => {
    t.classList.toggle('is-active', i === active);
    if (i === active) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current');
  });
}
function markTab() {
  if (Date.now() < holdUntil) return;
  const line = window.innerHeight * 0.35;
  let active = 0;
  let best = -Infinity;
  targets.forEach((t, i) => {
    if (!t || t.closest('.dash-side')) return;
    const top = t.getBoundingClientRect().top;
    if (top < line && top > best) { best = top; active = i; }
  });
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) active = tabs.length - 1;
  setTab(active);
}
tabs.forEach((t, i) => t.addEventListener('click', () => { setTab(i); holdUntil = Date.now() + 900; }));

// 3. Give the sticky top bar a hairline once the page has scrolled.
const bar = document.querySelector('.topbar');
function onScroll() {
  reveal();
  markTab();
  bar?.classList.toggle('is-scrolled', window.scrollY > 8);
}
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll);
window.addEventListener('load', onScroll);
onScroll();

// 4. When a ranked ghat is clicked, bring its detail into view (the detail sits
// below the ranking; the app already does this under 1180px).
document.addEventListener('click', (e) => {
  if (!e.target.closest('.ghat-card') || window.innerWidth < 1180) return;
  const detail = document.getElementById('detail');
  requestAnimationFrame(() => detail?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }));
});
