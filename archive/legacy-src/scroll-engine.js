/**
 * YAS CORE — 3D Scroll Reveal Engine v2
 * IntersectionObserver-driven. Stagger-aware. Memory-clean.
 */

if (window.__YAS_SCROLL_BOOTED__) {
  console.warn('[YAS CORE] Scroll engine already booted.');
} else {
  window.__YAS_SCROLL_BOOTED__ = true;

  const boot = () => {
    const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const REPEAT = true;   // Set false for one-way reveal

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target;

        if (entry.isIntersecting) {
          // Staggered children: data-stagger='80' → 80ms between kids
          const stagger = parseInt(el.dataset.stagger, 10);
          if (stagger > 0) {
            [...el.children].forEach((child, i) => {
              child.style.transitionDelay = `${i * stagger}ms`;
              child.classList.add('is-revealed');
            });
          }
          el.classList.add('is-revealed');

          // After transition: release will-change to free GPU layer
          if (!REPEAT) {
            const onDone = () => {
              el.style.willChange = 'auto';
              io.unobserve(el);
              el.removeEventListener('transitionend', onDone);
            };
            el.addEventListener('transitionend', onDone, { once: true });
          }
        } else if (REPEAT) {
          el.classList.remove('is-revealed');
          [...el.children].forEach((c) => c.classList.remove('is-revealed'));
        }
      }
    }, {
      root: null,
      rootMargin: REDUCED ? '0px' : '0px 0px -10% 0px',
      threshold: REDUCED ? 0 : [0.15],
    });

    const targets = document.querySelectorAll('.reveal-3d');
    targets.forEach((t) => io.observe(t));

    // Expose for late-mounted elements (e.g., dashboard cards)
    window.__YAS_OBSERVE_REVEAL__ = (el) => {
      if (el && !el.dataset.revealObserved) {
        el.dataset.revealObserved = 'true';
        io.observe(el);
      }
    };

    console.log(
      `%c[YAS CORE] 🎬 3D Scroll Engine Online — tracking ${targets.length} elements`,
      'color:#D4AF37;font-weight:700;'
    );
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
