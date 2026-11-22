export function parseRoute(hashString = window.location.hash) {
  const raw = (hashString || '').replace(/^#/, '').trim();
  const path = raw.startsWith('/') ? raw.slice(1) : raw;
  const parts = path.split('/').filter(Boolean).map((p) => decodeURIComponent(p));

  if (parts.length === 0) {
    return { section: 'home', param: null };
  }

  const [head, tail] = parts;
  switch (head) {
    case 'to-read':
      return { section: 'to-read', param: null };
    case 'read':
      return { section: 'read', param: null };
    case 'wishlist':
      return { section: 'wishlist', param: null };
    case 'genres':
    case 'genre':
      return { section: 'genres', param: tail || null };
    case 'authors':
    case 'author':
      return { section: 'authors', param: tail || null };
    case 'history':
      return { section: 'history', param: tail || null };
    case 'search':
      return { section: 'search', param: tail || null };
    case 'book':
      return { section: 'book', param: tail || null };
    default:
      return { section: 'home', param: null };
  }
}

export function setActiveNav(section) {
  const navLinks = document.querySelectorAll('[data-route]');
  navLinks.forEach((link) => {
    const route = link.getAttribute('data-route');
    const isMatch = route === section;
    link.classList.toggle('is-active', isMatch);
    if (isMatch) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

export function setPageTitle(pageTitle) {
  document.title = pageTitle
    ? `${pageTitle} — Nurzam’s Library`
    : 'Nurzam’s Library — Personal Book Catalogue & Reading Journal';
}

export function setupMobileNavigation() {
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  const drawer = document.getElementById('mobile-nav-drawer');
  if (!toggleBtn || !drawer) return;

  const closeMenu = () => {
    drawer.hidden = true;
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.setAttribute('aria-label', 'Open navigation menu');
  };

  const openMenu = () => {
    drawer.hidden = false;
    toggleBtn.setAttribute('aria-expanded', 'true');
    toggleBtn.setAttribute('aria-label', 'Close navigation menu');
  };

  toggleBtn.addEventListener('click', () => {
    if (drawer.hidden) {
      openMenu();
    } else {
      closeMenu();
    }
  });

  drawer.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !drawer.hidden) {
      closeMenu();
      toggleBtn.focus();
    }
  });

  return { closeMenu };
}
