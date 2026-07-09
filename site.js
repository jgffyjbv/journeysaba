// Journeys ABA — static site interactivity (vanilla JS, no dependencies)
document.documentElement.classList.add('js');
(function () {
  'use strict';

  /* ---------- Scroll-reveal (replays the original fade-up-on-scroll animation) ----------
     Deliberately scroll-listener-based (not IntersectionObserver): if reveal ever fails,
     content must still appear — a rect check on scroll cannot silently break. */
  var pending = [].slice.call(document.querySelectorAll('.rv'));
  var ticking = false;
  function revealCheck() {
    ticking = false;
    if (!pending.length) return;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var batch = 0;
    pending = pending.filter(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < vh * 0.94 && r.bottom > 0) {
        (function (e, d) { setTimeout(function () { e.classList.add('rv-in'); }, d); })(el, 110 + (batch % 6) * 90);
        batch++;
        return false;
      }
      return true;
    });
  }
  function onScroll() {
    if (!ticking) { ticking = true; (window.requestAnimationFrame || setTimeout)(revealCheck); }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  revealCheck();
  setTimeout(revealCheck, 400); // fonts/images may shift layout after first paint
  // absolute safety net: anything still pending after 12s becomes visible no matter what
  setTimeout(function () { pending.forEach(function (el) { el.classList.add('rv-in'); }); pending = []; }, 12000);

  /* ---------- Mobile menu ---------- */
  var menuBtn = document.querySelector('button[aria-label="Toggle menu"]');
  if (menuBtn) {
    var nav = document.querySelector('header nav');
    var panel = document.createElement('div');
    panel.id = 'lsb-mobile-menu';
    panel.style.cssText = 'display:none;position:absolute;top:100%;left:0;right:0;background:#fff;box-shadow:0 12px 24px rgba(0,0,0,.12);padding:12px 16px;z-index:60;';
    var links = nav ? nav.querySelectorAll('a') : [];
    links.forEach ? null : (links = [].slice.call(links));
    for (var i = 0; i < links.length; i++) {
      var a = document.createElement('a');
      a.href = links[i].getAttribute('href');
      a.textContent = links[i].textContent;
      a.style.cssText = 'display:block;padding:12px 8px;font-weight:700;color:#4C1D95;text-decoration:none;border-bottom:1px solid #f1f5f9;font-family:Nunito,sans-serif;';
      panel.appendChild(a);
    }
    var header = document.querySelector('header');
    if (header) { header.style.position = 'sticky'; header.appendChild(panel); }
    menuBtn.addEventListener('click', function () {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', function (e) {
      if (!header.contains(e.target)) panel.style.display = 'none';
    });
  }

  /* ---------- FAQ accordion (Radix markup: [data-state] triggers + hidden content) ---------- */
  document.querySelectorAll('h3 > button[data-state], button[data-state][aria-controls]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('data-state') === 'open';
      var contentId = btn.getAttribute('aria-controls');
      var content = contentId ? document.getElementById(contentId) : null;
      if (!content) {
        var item = btn.closest('[data-state]') && btn.closest('[data-state]').parentElement;
        content = btn.closest('[data-state]') ? btn.closest('[data-state]').nextElementSibling : null;
      }
      // close others in same accordion root
      var root = btn.closest('[data-orientation]') || document;
      root.querySelectorAll('button[data-state="open"]').forEach(function (b) {
        if (b === btn) return;
        b.setAttribute('data-state', 'closed');
        b.setAttribute('aria-expanded', 'false');
        var cb = b.getAttribute('aria-controls') && document.getElementById(b.getAttribute('aria-controls'));
        if (cb) { cb.setAttribute('data-state', 'closed'); cb.hidden = true; }
        var wrap = b.closest('[data-state]'); if (wrap && wrap !== b) wrap.setAttribute('data-state', 'closed');
        var it = b.closest('[data-orientation] > [data-state]'); if (it) it.setAttribute('data-state', 'closed');
      });
      btn.setAttribute('data-state', open ? 'closed' : 'open');
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (content) {
        content.setAttribute('data-state', open ? 'closed' : 'open');
        content.hidden = open;
        content.style.height = 'auto';
      }
      var wrapEl = btn.closest('div[data-state], [data-orientation] > [data-state]');
      if (wrapEl) wrapEl.setAttribute('data-state', open ? 'closed' : 'open');
      var itemEl = btn.parentElement && btn.parentElement.closest('[data-state]');
      if (itemEl) itemEl.setAttribute('data-state', open ? 'closed' : 'open');
    });
  });

  /* ---------- Chat bubble -> quick contact popup (original was an AI chatbot on Airo's backend) ---------- */
  var chat = document.getElementById('lsb-chat');
  if (chat) {
    var pop = document.getElementById('lsb-chat-pop');
    chat.addEventListener('click', function () {
      pop.style.display = pop.style.display === 'none' ? 'block' : 'none';
    });
  }

  /* ---------- Contact form: success state after FormSubmit redirect ---------- */
  if (/[?&]sent=1/.test(location.search)) {
    var form = document.querySelector('form');
    if (form) {
      var ok = document.createElement('div');
      ok.style.cssText = 'padding:24px;background:#F5F3FF;border:2px solid #7C3AED;border-radius:16px;text-align:center;font-family:Nunito,sans-serif;';
      ok.innerHTML = '<h3 style="color:#4C1D95;font-size:22px;font-weight:800;margin-bottom:8px;">Thank you!</h3><p style="color:#333;font-family:\'Open Sans\',sans-serif;">Your message has been sent. Our team will reach out within 1 business day.</p>';
      form.parentNode.replaceChild(ok, form);
      ok.scrollIntoView({ block: 'center' });
    }
  }
})();


/* Flipbook controller — vanilla JS, no dependencies.
   Drives the storybook section in flipbook.html:
   - Previous / Next buttons (.fb-prev / .fb-next)
   - Dot navigation (.fb-dot, aria-label "Go to spread N")
   - ArrowLeft / ArrowRight keyboard navigation
   - Light page-turn transition via CSS classes (fb-exit-* / fb-enter-*),
     matching the original's 420ms flip timing. */
(function () {
  'use strict';

  var FLIP_MS = 420;

  function init() {
    var book = document.getElementById('flipbook');
    if (!book) return;

    var spreads = Array.prototype.slice.call(book.querySelectorAll('.fb-spread'));
    var dots = Array.prototype.slice.call(book.querySelectorAll('.fb-dot'));
    var prevBtn = book.querySelector('.fb-prev');
    var nextBtn = book.querySelector('.fb-next');
    if (!spreads.length) return;

    var spread = 0;
    var flipping = false;
    var last = spreads.length - 1;

    // Start on whichever spread is marked active in the HTML (default 0).
    spreads.forEach(function (s, i) {
      if (s.classList.contains('fb-active')) spread = i;
    });

    var DOT_ACTIVE = 'fb-dot rounded-full transition-all w-6 h-2.5 bg-accent';
    var DOT_IDLE = 'fb-dot rounded-full transition-all w-2.5 h-2.5 bg-white/30 hover:bg-white/50';

    function updateUI() {
      dots.forEach(function (d, i) {
        d.className = i === spread ? DOT_ACTIVE : DOT_IDLE;
      });
      if (prevBtn) prevBtn.disabled = spread === 0 || flipping;
      if (nextBtn) nextBtn.disabled = spread === last || flipping;
    }

    function goTo(target) {
      if (flipping || target === spread || target < 0 || target > last) return;
      var forward = target > spread;
      var cur = spreads[spread];

      flipping = true;
      cur.classList.add(forward ? 'fb-exit-forward' : 'fb-exit-backward');
      updateUI();

      setTimeout(function () {
        cur.classList.remove('fb-active', 'fb-exit-forward', 'fb-exit-backward');

        spread = target;
        var next = spreads[spread];
        next.classList.add(forward ? 'fb-enter-forward' : 'fb-enter-backward', 'fb-active');
        // Force reflow so the enter position is applied before transitioning to center.
        void next.offsetWidth;
        next.classList.remove('fb-enter-forward', 'fb-enter-backward');

        flipping = false;
        updateUI();
      }, FLIP_MS);
    }

    function goNext() { goTo(spread + 1); }
    function goPrev() { goTo(spread - 1); }

    if (prevBtn) prevBtn.addEventListener('click', goPrev);
    if (nextBtn) nextBtn.addEventListener('click', goNext);

    dots.forEach(function (dot, i) {
      dot.addEventListener('click', function () { goTo(i); });
    });

    window.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    });

    updateUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
