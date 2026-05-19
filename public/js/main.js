// AUTH
function getUser() {
  try { return JSON.parse(localStorage.getItem('unschoolme_user') || 'null'); }
  catch { return null; }
}

function logout() {
  localStorage.removeItem('unschoolme_user');
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
  const navRight = document.querySelector('.nav-right');
  const navLinks = document.querySelector('.nav-links');
  if (!navRight) return;
  if (user) {
    const initials = user.name ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2) : 'U';
    navRight.innerHTML = `
      <div class="nav-user">
        <span class="nav-user-name">Hi, ${user.name ? user.name.split(' ')[0] : 'there'}</span>
        <div class="nav-avatar" title="Logout" onclick="logout()">${initials}</div>
      </div>
    `;
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

// READING PROGRESS
const bar = document.getElementById('readingProgress');
if (bar) {
  window.addEventListener('scroll', () => {
    bar.style.width = (window.scrollY / (document.body.scrollHeight - window.innerHeight) * 100) + '%';
  });
}

// ACTIVE NAV
document.querySelectorAll('.nav-links a').forEach(link => {
  if (link.getAttribute('href') === window.location.pathname) link.classList.add('active');
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

// INIT
updateNav();
handleUploadVisibility();
initMobileMenu();
addChatButton();
const user = getUser();
if (!user && window.location.pathname !== '/login') {
  setTimeout(showLoginSplash, 5000);
}
