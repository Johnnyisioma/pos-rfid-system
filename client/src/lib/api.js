/** Thin API client: auth token, active location header, and error unwrapping. */

const TOKEN_KEY = 'pos.token';
const LOCATION_KEY = 'pos.location';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));
export const getLocationId = () => Number(localStorage.getItem(LOCATION_KEY)) || null;
export const setLocationId = (id) =>
  id ? localStorage.setItem(LOCATION_KEY, String(id)) : localStorage.removeItem(LOCATION_KEY);

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function headers(extra = {}) {
  const h = { ...extra };
  const token = getToken();
  const loc = getLocationId();
  if (token) h.Authorization = `Bearer ${token}`;
  if (loc) h['X-Location-Id'] = String(loc);
  return h;
}

async function handle(res) {
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
  if (!res.ok) {
    if (res.status === 401) {
      setToken(null);
      if (!location.pathname.startsWith('/login')) location.href = '/login';
    }
    throw new ApiError(body.error || `Request failed (${res.status})`, res.status, body);
  }
  return body;
}

export const api = {
  get: (path) => fetch(path, { headers: headers() }).then(handle),

  post: (path, body) =>
    fetch(path, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body ?? {}),
    }).then(handle),

  put: (path, body) =>
    fetch(path, {
      method: 'PUT',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body ?? {}),
    }).then(handle),

  del: (path) => fetch(path, { method: 'DELETE', headers: headers() }).then(handle),

  upload: (path, file, field = 'file') => {
    const fd = new FormData();
    fd.append(field, file);
    return fetch(path, { method: 'POST', headers: headers(), body: fd }).then(handle);
  },

  /** Trigger a browser download for an export endpoint. */
  download: async (path, filename) => {
    const res = await fetch(path, { headers: headers() });
    if (!res.ok) return handle(res);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || path.split('/').pop().split('?')[0];
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { ok: true };
  },
};

export const qs = (params) => {
  const sp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.append(k, v);
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
};
