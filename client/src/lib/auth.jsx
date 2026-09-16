import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, setToken, getToken, setLocationId, getLocationId } from './api.js';
import { setCurrencySymbol } from './format.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [locations, setLocations] = useState([]);
  const [locationId, setLocation] = useState(getLocationId());
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    try {
      const s = await api.get('/api/settings');
      setSettings(s);
      setCurrencySymbol(s.currency_symbol);
    } catch { /* offline — keep whatever we had */ }
  }, []);

  const bootstrap = useCallback(async () => {
    if (!getToken()) { setLoading(false); return; }
    try {
      const me = await api.get('/api/auth/me');
      setUser(me.user);
      setLocations(me.locations);
      const current = getLocationId();
      const valid = me.locations.some((l) => l.id === current);
      const next = valid ? current : me.locations[0]?.id || null;
      setLocation(next);
      setLocationId(next);
      await loadSettings();
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [loadSettings]);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const login = async (email, password) => {
    const res = await api.post('/api/auth/login', { email, password });
    setToken(res.token);
    setUser(res.user);
    setLocations(res.locations);
    const first = res.locations[0]?.id || null;
    setLocation(first);
    setLocationId(first);
    await loadSettings();
    return res;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setLocations([]);
    location.href = '/login';
  };

  const switchLocation = (id) => {
    setLocation(id);
    setLocationId(id);
    window.dispatchEvent(new CustomEvent('pos:location-changed', { detail: id }));
  };

  const can = useCallback((permission) => {
    if (!user) return false;
    const list = user.permissions || [];
    if (list.includes('*') || list.includes(permission)) return true;
    return list.includes(`${permission.split('.')[0]}.*`);
  }, [user]);

  const value = useMemo(() => ({
    user, locations, locationId, settings, loading,
    location: locations.find((l) => l.id === locationId) || null,
    login, logout, switchLocation, can, reloadSettings: loadSettings,
  }), [user, locations, locationId, settings, loading, can, loadSettings]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
