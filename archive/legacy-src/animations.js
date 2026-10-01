import { resizeCanvas, stopLoop, startLoop } from './render.js';
import { createRegistry } from './event-registry.js';
import { DOMCache } from './dom-cache.js';

const registry = createRegistry();
const { on } = registry;

export function teardownAnimations() {
  registry.teardown();
}

export function initAnimations() {
  // ── Canvas resize — debounced to one rAF per resize burst ─
  let _resizeRaf = false;
  on(window, 'resize', () => {
    if (_resizeRaf) return;
    _resizeRaf = true;
    requestAnimationFrame(() => {
      resizeCanvas();
      DOMCache.refresh(); // invalidate cached element sizes after resize
      _resizeRaf = false;
    });
  }, { passive: true });

  // ── Scroll-reveal — IntersectionObserver replaces scroll polling ──
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) e.target.classList.add('in');
    });
  }, { threshold: 0.08 });
  document.querySelectorAll('.reveal, .reveal-scale').forEach(el => obs.observe(el));

  // ── Nav shrink on scroll ─────────────────────────────────────
  // Guard: only read DOMCache.nav (resolved once at boot via DOMCache.init())
  const nav = DOMCache.nav;
  if (nav) {
    let _scrollRaf = false;
    let _navScrolled = null; // stale-state guard: skip write if state unchanged
    on(window, 'scroll', () => {
      if (_scrollRaf) return;
      _scrollRaf = true;
      requestAnimationFrame(() => {
        const scrolled = window.scrollY > 60;
        if (scrolled !== _navScrolled) {
          _navScrolled = scrolled;
          nav.style.padding = scrolled ? '12px 56px' : '18px 56px';
        }
        _scrollRaf = false;
      });
    }, { passive: true });
  }

  // ── Card tilt — rAF-throttled, read-before-write ─────────────
  // getBoundingClientRect() is called ONCE at the start of the rAF callback
  // (before any writes) → clean layout read, no forced reflow.
  // Width/height are cached via DOMCache.getSize() and only re-read on resize.
  document.querySelectorAll('.role-card, .ps, .rev-card').forEach(card => {
    let _tiltRaf = false;
    on(card, 'mousemove', (e) => {
      if (_tiltRaf) return;
      _tiltRaf = true;
      requestAnimationFrame(() => {
        const { left, top } = card.getBoundingClientRect(); // read phase
        const { w, h } = DOMCache.getSize(card);           // cached width/height
        const x = (e.clientX - left) / w - 0.5;
        const y = (e.clientY - top)  / h - 0.5;
        card.style.transform =                              // write phase
          `perspective(800px) rotateY(${x * 12}deg) rotateX(${-y * 12}deg) translateY(-8px)`;
        _tiltRaf = false;
      });
    }, { passive: true });

    on(card, 'mouseleave', () => {
      card.style.transform = '';
    });
  });

  // ── Smooth scroll for anchor links ───────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    on(a, 'click', (e) => {
      e.preventDefault();
      const t = document.querySelector(a.getAttribute('href'));
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // ── Language toggle ───────────────────────────────────────────
  let isAR = false;
  window.toggleLang = function toggleLang() {
    isAR = !isAR;
    const html = DOMCache.htmlRoot;
    const btn  = DOMCache.langToggle;

    if (isAR) {
      html?.setAttribute('lang', 'ar');
      html?.setAttribute('dir', 'rtl');
      if (btn) btn.textContent = '🌐 English';
      document.title = 'UrLife — حيث تلتقي العقول';
    } else {
      html?.setAttribute('lang', 'en');
      html?.setAttribute('dir', 'ltr');
      if (btn) btn.textContent = '🌐 العربية';
      document.title = 'UrLife — Where Minds Meet';
    }

    document.querySelectorAll('[data-en][data-ar]').forEach(el => {
      const txt = isAR ? el.getAttribute('data-ar') : el.getAttribute('data-en');
      if (txt) el.innerHTML = txt;
    });

    const headingFont = isAR ? 'var(--font-ar)' : 'var(--font-en)';
    document.querySelectorAll('h1,h2,h3,h4,.nav-logo,.f-logo').forEach(el => {
      el.style.fontFamily = headingFont;
    });

    const pageWrap = DOMCache.pageWrap;
    if (pageWrap) {
      pageWrap.style.opacity   = '0';
      pageWrap.style.transform = 'translateY(10px)';
      // Double-rAF ensures initial state paints before the transition begins
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          pageWrap.style.transition = 'opacity .4s ease, transform .4s ease';
          pageWrap.style.opacity    = '1';
          pageWrap.style.transform  = 'translateY(0)';
        });
      });
    }
  };
}
