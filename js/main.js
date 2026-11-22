// NOTE: this file is a classic script that shares the global scope with each
// page's inline <script>. Avoid top-level const/let names that pages might also
// declare (e.g. `bar`, `user`) — a duplicate declaration throws a SyntaxError
// and stops this whole file from running.

// Canonical path without trailing slash ("/taxes/" → "/taxes")
function currentPath() {
  return window.location.pathname.replace(/\/+$/, '') || '/';
}

// Small non-blocking notice (used instead of alert for informational messages)
function umNotice(message) {
  let el = document.getElementById('umNotice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'umNotice';
    el.className = 'um-notice';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 6000);
}

// AUTH
function getUser() {
  try { return JSON.parse(localStorage.getItem('unschoolme_user') || 'null'); }
  catch { return null; }
}

function logout() {
  localStorage.removeItem('unschoolme_user');
  localStorage.removeItem('alex_done');
  fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
}

// SPLASH
function showLoginSplash() {
  if (document.getElementById('splashOverlay')) return;
  const splash = document.createElement('div');
  splash.id = 'splashOverlay';
  splash.className = 'splash-overlay';
  splash.innerHTML = `
    <div class="splash-card">
      <div class="splash-logo">Unschool<b>Me</b></div>
      <div class="splash-title">Ready to learn real life?</div>
      <div class="splash-sub">Join thousands learning what school never taught — taxes, banking, credit, government, and more.</div>
      <div class="splash-btns">
        <button class="splash-btn-main" onclick="window.location.href='/login?tab=signup'">Get Started — It's Free</button>
        <button class="splash-btn-sec" onclick="window.location.href='/login'">Log in to continue</button>
      </div>
      <span class="splash-login-link">Have an account? <a href="/login">Log in here</a></span>
    </div>
  `;
  document.body.appendChild(splash);
}

// UPDATE NAV
function updateNav() {
  const user = getUser();
  if (!user) return;
  const navRight = document.querySelector('.nav-right');
  const navLinks = document.querySelector('.nav-links');
  if (!navRight) return;
  const initials = user.name ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2) : 'U';
  navRight.innerHTML = `
    <div class="nav-user">
      <span class="nav-user-name">Hi, ${user.name ? user.name.split(' ')[0] : 'there'}</span>
      <div class="nav-avatar" title="View Profile">${initials}</div>
    </div>
  `;
  const navAvatar = navRight.querySelector('.nav-avatar');
  if (navAvatar) {
    navAvatar.style.cursor = 'pointer';
    navAvatar.onclick = () => window.location.href = '/profile';
  }
  if (user.role === 'creator' && navLinks) {
    if (!document.querySelector('.nav-creator')) {
      const link = document.createElement('a');
      link.href = '/upload';
      link.className = 'nav-creator';
      link.textContent = '🎬 Upload';
      navLinks.appendChild(link);
    }
  }
}

// UPLOAD VISIBILITY
function handleUploadVisibility() {
  const user = getUser();
  document.querySelectorAll('.upload-cta, .creator-only').forEach(el => {
    el.style.display = (!user || user.role !== 'creator') ? 'none' : '';
  });
}

// NAV SCROLL
window.addEventListener('scroll', () => {
  const nav = document.getElementById('nav');
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 50);
});

// PARALLAX
window.addEventListener('scroll', () => {
  const bg = document.getElementById('heroBg');
  if (bg) bg.style.transform = `translateY(${window.scrollY * 0.3}px)`;
});

// FADE UP
const fadeObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); fadeObserver.unobserve(e.target); } });
}, { threshold: 0.1 });
document.querySelectorAll('.fade-up').forEach(el => fadeObserver.observe(el));

// COUNTER
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      const el = e.target;
      const target = parseInt(el.getAttribute('data-count'));
      if (!target) return;
      let count = 0;
      const step = target / 40;
      const timer = setInterval(() => {
        count += step;
        if (count >= target) { el.textContent = target; clearInterval(timer); }
        else el.textContent = Math.floor(count);
      }, 30);
      counterObserver.unobserve(el);
    }
  });
}, { threshold: 0.5 });
document.querySelectorAll('[data-count]').forEach(el => counterObserver.observe(el));

// READING PROGRESS (block-scoped: several article pages declare their own `bar`)
{
  const progressEl = document.getElementById('readingProgress');
  if (progressEl) {
    window.addEventListener('scroll', () => {
      progressEl.style.width = (window.scrollY / (document.body.scrollHeight - window.innerHeight) * 100) + '%';
    });
  }
}

// ACTIVE NAV (highlights the section too, e.g. /taxes on /taxes/how-taxes-work)
document.querySelectorAll('.nav-links a').forEach(link => {
  const href = link.getAttribute('href');
  const here = currentPath();
  if (href && href !== '/' && (here === href || here.startsWith(href + '/'))) link.classList.add('active');
});

// HERO LOADED
window.addEventListener('load', () => {
  const bg = document.getElementById('heroBg');
  if (bg) bg.classList.add('loaded');
});

// MOBILE MENU
function initMobileMenu() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const hamburger = document.createElement('button');
  hamburger.className = 'hamburger';
  hamburger.setAttribute('aria-label', 'Menu');
  hamburger.innerHTML = '<span></span><span></span><span></span>';
  nav.appendChild(hamburger);
  const mobileMenu = document.createElement('div');
  mobileMenu.className = 'mobile-menu';
  const links = nav.querySelector('.nav-links');
  if (links) mobileMenu.innerHTML = links.innerHTML;
  // The Log in button is hidden on small screens, so expose account links here
  const extra = getUser()
    ? [['/chat', '💬 Ask Anything'], ['/profile', '👤 My Profile']]
    : [['/chat', '💬 Ask Anything'], ['/login', 'Log in'], ['/login?tab=signup', 'Get Started →']];
  extra.forEach(([href, text]) => {
    if (mobileMenu.querySelector(`a[href="${href}"]`)) return;
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    mobileMenu.appendChild(a);
  });
  document.body.appendChild(mobileMenu);
  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('open');
    mobileMenu.classList.toggle('open');
    document.body.classList.toggle('menu-open');
  });
  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.classList.remove('open');
      mobileMenu.classList.remove('open');
      document.body.classList.remove('menu-open');
    });
  });
}

// CHAT BUTTON
function addChatButton() {
  const navRight = document.querySelector('.nav-right');
  if (!navRight) return;
  if (document.querySelector('.nav-chat-btn')) return;
  const chatBtn = document.createElement('a');
  chatBtn.href = '/chat';
  chatBtn.className = 'nav-chat-btn';
  chatBtn.textContent = '💬 Ask';
  navRight.insertBefore(chatBtn, navRight.firstChild);
}

// CATEGORY ACCORDION
function initCategories() {
  document.querySelectorAll('.category-header').forEach(header => {
    header.addEventListener('click', () => {
      const card = header.parentElement;
      const isOpen = card.classList.contains('open');
      document.querySelectorAll('.category-card').forEach(c => c.classList.remove('open'));
      if (!isOpen) card.classList.add('open');
    });
  });
  const first = document.querySelector('.category-card');
  if (first) first.classList.add('open');
}

// DEEP DIVE ACCORDION
document.querySelectorAll('.dd-question').forEach(q => {
  q.addEventListener('click', () => {
    q.parentElement.classList.toggle('open');
  });
});

// INIT
updateNav();
handleUploadVisibility();
initMobileMenu();
addChatButton();
initCategories();
wireActionButtons();
if (!getUser() && currentPath() !== '/login' && !sessionStorage.getItem('splashShown')) {
  setTimeout(() => {
    sessionStorage.setItem('splashShown', '1');
    showLoginSplash();
  }, 5000);
}
initAlex();

// ── ALEX ONBOARDING AGENT ──────────────────────────────────────────

function initAlex() {
  const user = getUser();
  if (!user) return;
  if (localStorage.getItem('alex_done_' + user.id)) return;
  if (window.location.pathname !== '/') return;
  setTimeout(() => { showAlex(); }, 2000);
}

function showAlex() {
  const overlay = document.createElement('div');
  overlay.id = 'alex-overlay';
  overlay.innerHTML = `
    <div class="alex-card" id="alexCard">
      <button class="alex-close" onclick="dismissAlex()">×</button>
      <div class="alex-header">
        <div class="alex-avatar">👋</div>
        <div class="alex-info">
          <div class="alex-name">Alex</div>
          <div class="alex-role">Your UnschoolMe Guide</div>
        </div>
      </div>
      <div class="alex-messages" id="alexMessages"></div>
      <div class="alex-options" id="alexOptions"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  alexStep(0);
}

const alexUser = JSON.parse(localStorage.getItem('unschoolme_user') || '{}');
const alexName = alexUser.name ? alexUser.name.split(' ')[0] : 'there';

const alexConversation = [
  {
    message: `Hey ${alexName}! 👋 I'm Alex, your guide here at UnschoolMe. I'll show you around in just 2 minutes!`,
    options: [
      { text: "Let's go! 🚀", next: 1 },
      { text: "Skip for now", action: 'dismiss' }
    ]
  },
  {
    message: "UnschoolMe teaches you real life skills that school never did — taxes, banking, credit, your rights, and more. Everything is free to start. 📚",
    options: [
      { text: "What topics are there?", next: 2 },
      { text: "Sounds great, show me!", next: 3 }
    ]
  },
  {
    message: "We have 3 main categories: 💰 Finance & Money (taxes, banking, credit, investing), 🏛️ Government & Rights (your rights, voting, immigration), and 💼 Business & Career (freelancing, college, housing). Click any category on the homepage to explore!",
    options: [
      { text: "How do I learn?", next: 3 },
      { text: "I'll explore now!", action: 'dismiss' }
    ]
  },
  {
    message: "Each topic has articles, video lessons, and a deep dive section with real Q&As. Read at your own pace — everything is organized by topic. 🎯",
    options: [
      { text: "Can I ask questions?", next: 4 },
      { text: "Got it, let me explore!", action: 'dismiss' }
    ]
  },
  {
    message: "Yes! Click the 💬 Ask button in the top nav anytime. Our chatbot knows hundreds of questions about taxes, salary by state, credit, rights, and more. Try asking 'How much is my salary after taxes in California?'",
    options: [
      { text: "What else can I do?", next: 5 },
      { text: "I'll try the chatbot!", action: 'chat' }
    ]
  },
  {
    message: "You can also upload your own lessons if you are a Creator! Share what you know and help others learn real life skills. 🎬",
    options: [
      { text: "One last thing...", next: 6 },
      { text: "I'm a learner, got it!", action: 'finish' }
    ]
  },
  {
    message: `You're all set, ${alexName}! 🎉 Start by picking a topic that matters to you right now. Remember — every article here is something school should have taught you. Good luck!`,
    options: [
      { text: "Start learning! 🚀", action: 'finish' }
    ]
  }
];

function alexStep(index) {
  const step = alexConversation[index];
  if (!step) return;
  const messages = document.getElementById('alexMessages');
  const options = document.getElementById('alexOptions');
  if (!messages || !options) return;
  const msg = document.createElement('div');
  msg.className = 'alex-msg';
  msg.textContent = step.message;
  messages.appendChild(msg);
  messages.scrollTop = messages.scrollHeight;
  setTimeout(() => {
    options.innerHTML = '';
    step.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'alex-opt-btn';
      btn.textContent = opt.text;
      btn.onclick = () => {
        if (opt.action === 'dismiss') dismissAlex();
        else if (opt.action === 'finish') finishAlex();
        else if (opt.action === 'chat') { finishAlex(); window.location.href = '/chat'; }
        else alexStep(opt.next);
      };
      options.appendChild(btn);
    });
  }, 600);
}

function dismissAlex() {
  const overlay = document.getElementById('alex-overlay');
  if (overlay) overlay.remove();
  const u = getUser();
  if (u) localStorage.setItem('alex_done_' + u.id, '1');
}

function finishAlex() {
  const messages = document.getElementById('alexMessages');
  const options = document.getElementById('alexOptions');
  if (messages) messages.innerHTML = '<div class="alex-msg">Great! Enjoy learning. I\'ll be here if you need me. 😊</div>';
  if (options) options.innerHTML = '<button class="alex-opt-btn" onclick="dismissAlex()">Close</button>';
  const u = getUser();
  if (u) localStorage.setItem('alex_done_' + u.id, '1');
}

// ── LEARNING PROGRESS TRACKING ─────────────────────────────────────

function trackArticleRead(topic, articleTitle, articleUrl) {
  const user = getUser();
  if (!user) return;

  let progress = JSON.parse(localStorage.getItem('um_progress') || '{}');
  if (!progress[topic]) progress[topic] = [];

  // Add if not already tracked
  const exists = progress[topic].find(a => a.url === articleUrl);
  if (!exists) {
    progress[topic].push({
      title: articleTitle,
      url: articleUrl,
      readAt: new Date().toISOString()
    });
    localStorage.setItem('um_progress', JSON.stringify(progress));
  }
}

// Auto-track when user visits an article page
// Detect article pages by URL depth (e.g. /taxes/how-taxes-work)
function autoTrackPage() {
  const user = getUser();
  if (!user) return;

  const path = currentPath();
  const parts = path.split('/').filter(Boolean);

  // Article pages have 2 path segments like /taxes/how-taxes-work
  if (parts.length === 2) {
    const topic = parts[0];
    const articleSlug = parts[1];
    const title = document.title.replace(' — UnschoolMe', '');
    trackArticleRead(topic, title, path);
  }
}

autoTrackPage();

// ── BOOKMARK BUTTON ─────────────────────────────────────────────────

function addBookmarkButton() {
  const path = currentPath();
  const parts = path.split('/').filter(Boolean);
  if (parts.length !== 2) return; // only on article pages

  const user = getUser();
  if (!user) return;

  const bookmarks = JSON.parse(localStorage.getItem('um_bookmarks') || '[]');
  const isBookmarked = bookmarks.find(b => b.url === path);

  const btn = document.createElement('button');
  btn.id = 'bookmarkBtn';
  btn.className = 'bookmark-btn';
  btn.innerHTML = isBookmarked ? '🔖 Saved' : '🔖 Save Article';
  btn.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#0A0A1E;color:#C8A96E;border:1px solid #C8A96E;border-radius:10px;padding:10px 18px;font-size:13px;font-family:Plus Jakarta Sans,sans-serif;cursor:pointer;z-index:1000;';

  btn.onclick = () => {
    let bm = JSON.parse(localStorage.getItem('um_bookmarks') || '[]');
    const exists = bm.find(b => b.url === path);
    if (exists) {
      bm = bm.filter(b => b.url !== path);
      btn.innerHTML = '🔖 Save Article';
    } else {
      bm.push({ title: document.title.replace(' — UnschoolMe', ''), url: path, savedAt: new Date().toISOString() });
      btn.innerHTML = '🔖 Saved';
    }
    localStorage.setItem('um_bookmarks', JSON.stringify(bm));
  };

  document.body.appendChild(btn);
}

addBookmarkButton();

// ── AFFILIATE CTA ────────────────────────────────────────────────────
// Wires <a data-affiliate-key="banking"> etc to window.AFFILIATE_LINKS,
// which is generated server-side from env vars in /js/config.js so real
// affiliate URLs can be swapped without touching any HTML/JS.
// If no URL is configured for a key, the CTA is hidden instead of pointing at a
// placeholder domain.
function wireAffiliateCTAs() {
  document.querySelectorAll('[data-affiliate-key]').forEach(el => {
    const key = el.getAttribute('data-affiliate-key');
    const url = window.AFFILIATE_LINKS && window.AFFILIATE_LINKS[key];
    if (url) el.setAttribute('href', url);
    else el.style.display = 'none';
  });
}
wireAffiliateCTAs();

// ── CONTACT LINKS ────────────────────────────────────────────────────
// <a data-contact-link> uses CONTACT_EMAIL (from /js/config.js) when set;
// otherwise it keeps its fallback href (/chat).
function wireContactLinks() {
  const email = window.SITE_CONFIG && window.SITE_CONFIG.contactEmail;
  if (!email) return;
  document.querySelectorAll('[data-contact-link]').forEach(el => el.setAttribute('href', 'mailto:' + email));
}
wireContactLinks();

// ── ACTION BUTTONS ───────────────────────────────────────────────────
// Many pages share the same buttons (nav Log in / Get Started, Premium CTAs,
// Upload a Lesson) without their own handlers. Wire them all in one place.
// Buttons that already have an onclick or id-specific handler are skipped.
function wireActionButtons() {
  const go = href => () => { window.location.href = href; };
  const goUpload = () => {
    const u = getUser();
    if (!u) window.location.href = '/login?tab=signup';
    else if (u.role !== 'creator') umNotice('Uploading lessons is for Creator accounts. Sign up with the Creator role to share a lesson.');
    else window.location.href = '/upload';
  };
  const paidPlan = () => umNotice('Paid plans aren\'t open for checkout yet. Create a free account now — every free article is already unlocked.');

  const rules = [
    ['.btn-ghost, .nbtn1', go('/login')],
    ['.btn-gold, .nbtn2', go('/login?tab=signup')],
    ['.btn-red, .tc-btn', goUpload],
    ['.pc-btn', go('/#pricing')],
    ['.plan-btn.free', btn => /starter/i.test(btn.textContent) ? paidPlan : go('/login?tab=signup')],
    ['.plan-btn.gold', paidPlan],
  ];
  rules.forEach(([selector, handler]) => {
    document.querySelectorAll(selector).forEach(btn => {
      if (btn.tagName !== 'BUTTON' || btn.onclick || btn.dataset.wired) return;
      const fn = handler.length === 1 ? handler(btn) : handler;
      btn.addEventListener('click', fn);
      btn.dataset.wired = '1';
    });
  });
}

// ── FOR PARENTS BANNER ───────────────────────────────────────────────
function initParentBanner() {
  const banner = document.getElementById('parentBanner');
  if (!banner) return;
  if (localStorage.getItem('um_parent_banner_dismissed')) { banner.remove(); return; }
  const closeBtn = document.getElementById('parentBannerClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      banner.remove();
      localStorage.setItem('um_parent_banner_dismissed', '1');
    });
  }
}
initParentBanner();
