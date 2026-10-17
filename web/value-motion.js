/* Quiet, interruptible value transitions shared by the wide display. */
(function () {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const seen = new WeakSet();
  const active = new Map();
  const easing = 'cubic-bezier(.22, 1, .36, 1)';

  function settle(node) { active.get(node)?.(); }
  function setText(node, value) {
    if (!node) return;
    const next = String(value ?? '');
    const previous = node.textContent;
    const initialized = seen.has(node);
    seen.add(node);
    if (previous === next) return;
    settle(node);
    node.textContent = next;
    if (!initialized || !previous || !next || reduced.matches || document.hidden ||
        !node.isConnected || !node.animate || !node.checkVisibility?.({ visibilityProperty: true, opacityProperty: true })) return;

    // Numbers roll only the changing glyphs; separators and unchanged digits stay still.
    // Temporary wrappers are removed at rest, preserving the original typography.
    const numeric = /^[\d\s:.,°+−–\-/%FChms]+$/.test(next) &&
      /^[\d\s:.,°+−–\-/%FChms]+$/.test(previous) && next.length === previous.length;
    const animations = [];
    const fragment = document.createDocumentFragment();
    function incoming(text, distance) {
      const span = document.createElement('span');
      span.textContent = text;
      span.style.display = numeric ? 'inline-block' : 'block';
      if (!numeric) { span.style.overflow = 'inherit'; span.style.textOverflow = 'inherit'; }
      fragment.appendChild(span);
      animations.push(span.animate([
        { opacity: 0, transform: `translateY(${distance})` },
        { opacity: 1, transform: 'translateY(0)' }
      ], { duration: numeric ? 460 : 520, easing }));
      return span;
    }
    if (numeric) {
      [...next].forEach((char, i) => {
        if (char === previous[i]) { fragment.appendChild(document.createTextNode(char)); return; }
        const span = incoming(char, '.24em');
        const cell = document.createElement('span');
        cell.style.cssText = 'display:inline-block;position:relative';
        fragment.replaceChild(cell, span);
        cell.appendChild(span);
        // A pseudo-element keeps the outgoing glyph out of textContent and accessibility.
        const old = document.createElement('span');
        old.className = 'value-motion-old';
        old.dataset.glyph = previous[i];
        old.setAttribute('aria-hidden', 'true');
        cell.appendChild(old);
        // Both layers share a baseline and never affect surrounding layout.
        animations.push(old.animate([
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(-.24em)' }
        ], { duration: 220, easing, fill: 'forwards' }));
      });
    } else {
      const span = incoming(next, '4px');
      const layer = document.createElement('span');
      layer.style.cssText = 'display:block;position:relative;overflow:inherit;text-overflow:inherit';
      fragment.replaceChild(layer, span);
      layer.appendChild(span);
      const old = document.createElement('span');
      old.className = 'value-motion-old';
      old.dataset.glyph = previous;
      old.setAttribute('aria-hidden', 'true');
      layer.appendChild(old);
      animations.push(old.animate([
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(-3px)' }
      ], { duration: 180, easing, fill: 'forwards' }));
    }
    node.replaceChildren(fragment);
    const finish = () => {
      if (active.get(node) !== finish) return;
      active.delete(node);
      animations.forEach(animation => animation.cancel());
      node.textContent = next;
    };
    active.set(node, finish);
    Promise.all(animations.map(animation => animation.finished.catch(() => {}))).then(finish);
  }
  function finishAll() { [...active.values()].forEach(finish => finish()); }
  reduced.addEventListener('change', () => { if (reduced.matches) finishAll(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) finishAll(); });
  window.DashValueMotion = { setText, finishAll };
})();
