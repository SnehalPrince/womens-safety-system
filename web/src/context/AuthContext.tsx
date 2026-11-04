import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';

export interface User {
  id: number;
  name: string;
  phone: string;
  role: 'user' | 'admin';
  created_at: string;
}

export interface Contact {
  id: number;
  name: string;
  phone: string;
  relation: string;
  priority: number;
}

export interface Device {
  device_id: string;
  sim_number: string | null;
  last_seen_at: string | null;
  paired_at: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  contacts: Contact[];
  pairedDevice: Device | null;
  isLoading: boolean;
  darkMode: boolean;
  toggleDarkMode: () => void;
  login: (phone: string, password: string) => Promise<User>;
  register: (name: string, phone: string, password: string) => Promise<User>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pairedDevice, setPairedDevice] = useState<Device | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  const toggleDarkMode = () => setDarkMode((prev) => !prev);

  const refreshUser = useCallback(async () => {
    if (!localStorage.getItem('token')) {
      setUser(null);
      setContacts([]);
      setPairedDevice(null);
      setIsLoading(false);
      return;
    }

    try {
      const data = await api.get<{ user: User; pairedDevice: Device | null; contacts: Contact[] }>('/api/auth/me');
      setUser(data.user);
      setPairedDevice(data.pairedDevice);
      setContacts(data.contacts);
    } catch (err) {
      console.warn('Failed to fetch user profile, clearing session:', err);
      localStorage.removeItem('token');
      setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (phone: string, password: string): Promise<User> => {
    const data = await api.post<{ token: string; user: User }>('/api/auth/login', { phone, password });
    localStorage.setItem('token', data.token);
    setToken(data.token);
    setUser(data.user);
    await refreshUser();
    return data.user;
  };

  const register = async (name: string, phone: string, password: string): Promise<User> => {
    const data = await api.post<{ token: string; user: User }>('/api/auth/register', { name, phone, password });
    localStorage.setItem('token', data.token);
    setToken(data.token);
    setUser(data.user);
    await refreshUser();
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setContacts([]);
    setPairedDevice(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        contacts,
        pairedDevice,
        isLoading,
        darkMode,
        toggleDarkMode,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
