/* ═══════════════════════════════════════════════
   GLÖ SALON — API Client (fetch wrappers)
═══════════════════════════════════════════════ */

const API_BASE = (window.location.protocol.startsWith('http') && window.location.port)
  ? `${window.location.protocol}//${window.location.hostname}:${window.location.port}/api`
  : 'http://localhost:5000/api';

// ─── Auth helpers ──────────────────────────────
function getToken()         { return localStorage.getItem('glo_token'); }
function setToken(t)        { localStorage.setItem('glo_token', t); }
function removeToken()      { localStorage.removeItem('glo_token'); localStorage.removeItem('glo_user'); }
function getUser()          { try { return JSON.parse(localStorage.getItem('glo_user')); } catch { return null; } }
function setUser(u)         { localStorage.setItem('glo_user', JSON.stringify(u)); }
function isLoggedIn()       { return !!getToken(); }

// ─── Base fetch ────────────────────────────────
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, {
    ...options,
    headers,
    credentials: 'include' // Transports HttpOnly secure cookies automatically
  });
  const data = await res.json().catch(() => ({}));

  // ─── Auto-handle expired / invalid session ─────────────────────────
  // If the server says the token is gone, clear local storage immediately
  // so the user gets redirected to login with a proper message instead of
  // seeing a cryptic "Invalid or expired session token" error toast.
  if (res.status === 401) {
    const isAuthRoute = path.startsWith('/auth/send-otp') || path.startsWith('/auth/verify-otp');
    if (!isAuthRoute) {
      // Stale token — wipe it and redirect
      removeToken();
      showToast('Your session has expired. Please log in again.', 'error');
      setTimeout(() => {
        const current = encodeURIComponent(window.location.pathname.split('/').pop() + window.location.search);
        window.location.href = `login.html?redirect=${current}`;
      }, 1800);
      // Throw so callers don't proceed
      throw new Error('Session expired. Redirecting to login…');
    }
  }

  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── Auth API ──────────────────────────────────
const AuthAPI = {
  sendOtp:    (phone, name) => apiFetch('/auth/send-otp', { method: 'POST', body: JSON.stringify({ phone, name }) }),
  verifyOtp:  (phone, otp)  => apiFetch('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ phone, otp }) }),
  getMe:      ()            => apiFetch('/auth/me'),
  updateProfile: (data)     => apiFetch('/auth/profile', { method: 'PUT', body: JSON.stringify(data) }),
  setupMFA:   ()            => apiFetch('/auth/mfa/setup', { method: 'POST' }),
  verifyMFA:  (token)       => apiFetch('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ token }) }),
  addAddress: (data)        => apiFetch('/auth/addresses', { method: 'POST', body: JSON.stringify(data) }),
  deleteAddress: (id)       => apiFetch(`/auth/addresses/${id}`, { method: 'DELETE' }),
  logout:     ()            => apiFetch('/auth/logout', { method: 'POST' }).catch(() => {})
};

// ─── Services API ──────────────────────────────
const ServicesAPI = {
  getAll:   (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/services${q ? '?' + q : ''}`);
  },
  getById:  (id)          => apiFetch(`/services/${id}`),
  create:   (data, adminKey) => apiFetch('/services', {
    method: 'POST', body: JSON.stringify(data),
    headers: { 'x-admin-key': adminKey }
  }),
  update: (id, data, adminKey) => apiFetch(`/services/${id}`, {
    method: 'PUT', body: JSON.stringify(data),
    headers: { 'x-admin-key': adminKey }
  }),
  remove: (id, adminKey) => apiFetch(`/services/${id}`, {
    method: 'DELETE',
    headers: { 'x-admin-key': adminKey }
  })
};

// ─── Salons API ────────────────────────────────
const SalonsAPI = {
  getAll:     (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/salons${q ? '?' + q : ''}`);
  },
  getById:    (id)          => apiFetch(`/salons/${id}`),
  register:   (data)        => apiFetch('/salons/register', { method: 'POST', body: JSON.stringify(data) }),
  getMySalon: ()            => apiFetch('/salons/my-salon'),
  updateMySalon: (data)     => apiFetch('/salons/my-salon', { method: 'PUT', body: JSON.stringify(data) }),
  approve: (id, adminKey)   => apiFetch(`/salons/${id}/approve`, { method: 'PATCH', headers: { 'x-admin-key': adminKey } }),
  reject:  (id, adminKey)   => apiFetch(`/salons/${id}/reject`,  { method: 'PATCH', headers: { 'x-admin-key': adminKey } }),
  adminAll: (adminKey)      => apiFetch('/salons/admin/all', { headers: { 'x-admin-key': adminKey } })
};

// ─── Bookings API ──────────────────────────────
const BookingsAPI = {
  getSlots:   (serviceId, date, salonId) => apiFetch(`/bookings/slots/${serviceId}/${date}?salonId=${salonId}`),
  create:     (data)        => apiFetch('/bookings', { method: 'POST', body: JSON.stringify(data) }),
  getMy:      ()            => apiFetch('/bookings/my'),
  cancel:     (id)          => apiFetch(`/bookings/${id}/cancel`, { method: 'PATCH' }),
  adminAll: (adminKey, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/bookings/admin/all${q ? '?' + q : ''}`, { headers: { 'x-admin-key': adminKey } });
  }
};

// ─── Reviews API ───────────────────────────────
const ReviewsAPI = {
  getBySalon: (salonId)    => apiFetch(`/reviews/salon/${salonId}`),
  create:     (data)       => apiFetch('/reviews', { method: 'POST', body: JSON.stringify(data) }),
  adminAll:   (adminKey)   => apiFetch('/reviews/admin/all', { headers: { 'x-admin-key': adminKey } }),
  toggle:  (id, adminKey)  => apiFetch(`/reviews/${id}/toggle`, { method: 'PATCH', headers: { 'x-admin-key': adminKey } })
};

// ─── Admin API ─────────────────────────────────
const AdminAPI = {
  getStats: (adminKey) => apiFetch('/admin/stats', { headers: { 'x-admin-key': adminKey } })
};

// ─── Payments API ──────────────────────────────
const PaymentsAPI = {
  getConfig: () => apiFetch('/payments/config'),
  createOrder: (bookingId) => apiFetch('/payments/create-order', { method: 'POST', body: JSON.stringify({ bookingId }) }),
  verify: (data) => apiFetch('/payments/verify', { method: 'POST', body: JSON.stringify(data) }),
  refund: (bookingId) => apiFetch('/payments/refund', { method: 'POST', body: JSON.stringify({ bookingId }) }),
  status: (bookingId) => apiFetch(`/payments/status/${bookingId}`)
};

// ─── Profile API (Role-Based) ──────────────────
const ProfileAPI = {
  getClientProfile: () => apiFetch('/profile/client'),
  updateClientProfile: (data) => apiFetch('/profile/client', { method: 'PATCH', body: JSON.stringify(data) }),
  getOwnerProfile: () => apiFetch('/profile/owner'),
  updateOwnerProfile: (data) => apiFetch('/profile/owner', { method: 'PATCH', body: JSON.stringify(data) })
};

window.ProfileAPI = ProfileAPI;

window.api = {
  auth: AuthAPI,
  profile: ProfileAPI,
  services: ServicesAPI,
  salons: SalonsAPI,
  bookings: BookingsAPI,
  reviews: ReviewsAPI,
  admin: AdminAPI,
  payments: PaymentsAPI
};

// ─── Toast notifications ───────────────────────
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type]}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.animation = 'slideIn 0.3s ease reverse'; setTimeout(() => toast.remove(), 300); }, 4000);
}

// ─── Scroll animation (IntersectionObserver) ───
function initFadeIn() {
  const els = document.querySelectorAll('.fade-in');
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
  }, { threshold: 0.1 });
  els.forEach(el => obs.observe(el));
}

// ─── Hamburger menu ────────────────────────────
function initMobileMenu() {
  const btn = document.getElementById('hamburger');
  const menu = document.getElementById('mobile-menu');
  if (btn && menu) {
    btn.addEventListener('click', () => menu.classList.toggle('open'));
    document.addEventListener('click', e => {
      if (!btn.contains(e.target) && !menu.contains(e.target)) menu.classList.remove('open');
    });
  }
}

// ─── Update nav auth state ─────────────────────
function updateNavAuth() {
  const user = getUser();
  const loginLink  = document.getElementById('nav-login-link');
  const logoutBtn  = document.getElementById('nav-logout-btn');
  const bookingsLink = document.getElementById('nav-bookings-link');
  const profileIcon = document.getElementById('profile-icon-container');
  if (user) {
    if (loginLink)  loginLink.style.display = 'none';
    if (logoutBtn)  logoutBtn.style.display = 'flex';
    if (bookingsLink) bookingsLink.style.display = 'flex';
    if (profileIcon) {
      profileIcon.style.display = 'flex';
      // Route salon owners to Salon Owner profile, clients to Client profile
      const profileLink = profileIcon.querySelector('a');
      if (profileLink) {
        if (user.role === 'salon_owner') {
          profileIcon.title = 'Salon Owner Profile';
          profileLink.href = 'salon-profile.html';
        } else {
          profileIcon.title = 'My Profile';
          profileLink.href = 'profile.html';
        }
      }

      // Also sync mobile menu profile link if present
      const mobileProfileLink = document.querySelector('#mobile-menu a[href="profile.html"], #mobile-menu a[href="salon-profile.html"]');
      if (mobileProfileLink) {
        if (user.role === 'salon_owner') {
          mobileProfileLink.textContent = 'Salon Profile';
          mobileProfileLink.href = 'salon-profile.html';
        } else {
          mobileProfileLink.textContent = 'My Profile';
          mobileProfileLink.href = 'profile.html';
        }
      }
    }
    const nameEl = document.getElementById('nav-user-name');
    if (nameEl) nameEl.textContent = user.name || user.phone;
  } else {
    if (loginLink)  loginLink.style.display = 'flex';
    if (logoutBtn)  logoutBtn.style.display = 'none';
    if (bookingsLink) bookingsLink.style.display = 'none';
    if (profileIcon) profileIcon.style.display = 'none';
  }
}

// ─── Logout ────────────────────────────────────
async function logout() {
  try {
    await AuthAPI.logout(); // Clears HttpOnly cookie on server
  } catch (_) { /* ignore network errors during logout */ }
  removeToken();
  showToast('Logged out successfully', 'info');
  setTimeout(() => window.location.href = 'index.html', 900);
}

// ─── Format currency ───────────────────────────
function formatINR(amount) {
  return '₹' + Number(amount).toLocaleString('en-IN');
}

// ─── Format date ───────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Star rating render ────────────────────────
function renderStars(rating) {
  return Array.from({ length: 5 }, (_, i) =>
    `<span style="color:${i < Math.floor(rating) ? '#F4B942' : '#ddd'}">★</span>`
  ).join('');
}

// ─── Init on load ──────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initFadeIn();
  initMobileMenu();
  updateNavAuth();
});
