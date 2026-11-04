import React, { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext.js';
import { Navbar } from './components/Navbar.js';
import { OfflineBanner } from './components/OfflineBanner.js';
import { VictimAuth } from './pages/victim/VictimAuth.js';
import { VictimOnboarding } from './pages/victim/VictimOnboarding.js';
import { VictimHome } from './pages/victim/VictimHome.js';
import { VictimActiveSos } from './pages/victim/VictimActiveSos.js';
import { AdminLogin } from './pages/admin/AdminLogin.js';
import { AdminDashboard } from './pages/admin/AdminDashboard.js';
import { AdminUsers } from './pages/admin/AdminUsers.js';
import { api } from './api/client.js';

export const AppContent: React.FC = () => {
  const { user, contacts, isLoading, refreshUser } = useAuth();

  // Navigation tab state ('app' or 'admin')
  const [currentTab, setCurrentTab] = useState<'app' | 'admin'>(() => {
    return window.location.pathname.startsWith('/admin') ? 'admin' : 'app';
  });

  const [activeIncidentId, setActiveIncidentId] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [adminView, setAdminView] = useState<'dashboard' | 'users'>('dashboard');

  // Sync tab with URL
  const handleNavigateTab = (tab: 'app' | 'admin') => {
    setCurrentTab(tab);
    if (tab === 'admin') {
      window.history.pushState({}, '', '/admin');
    } else {
      window.history.pushState({}, '', '/');
    }
  };

  // Check for active incident on load
  useEffect(() => {
    if (!user || user.role === 'admin') return;

    const checkActiveIncident = async () => {
      try {
        const res = await api.get<{ active: boolean; incident: { id: number } | null }>('/api/incidents/active');
        if (res.active && res.incident) {
          setActiveIncidentId(res.incident.id);
        } else {
          setActiveIncidentId(null);
        }
      } catch (err) {
        console.warn('Failed to check active incident:', err);
      }
    };

    checkActiveIncident();
  }, [user]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-red-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-semibold text-slate-500">Initializing Guardian SOS...</span>
        </div>
      </div>
    );
  }

  // Admin Portal Routes
  if (currentTab === 'admin') {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col">
        <Navbar currentTab={currentTab} onNavigateTab={handleNavigateTab} />
        <OfflineBanner />

        {!user || user.role !== 'admin' ? (
          <AdminLogin onSuccess={refreshUser} />
        ) : (
          <main className="flex-1">
            <div className="max-w-7xl mx-auto px-4 pt-3 flex items-center justify-end gap-2">
              <button
                onClick={() => setAdminView('dashboard')}
                className={`px-3 py-1 text-xs font-bold rounded-lg cursor-pointer transition-colors ${
                  adminView === 'dashboard'
                    ? 'bg-red-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                Live Dispatch
              </button>
              <button
                onClick={() => setAdminView('users')}
                className={`px-3 py-1 text-xs font-bold rounded-lg cursor-pointer transition-colors ${
                  adminView === 'users'
                    ? 'bg-red-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                Users & Bands
              </button>
            </div>

            {adminView === 'dashboard' ? <AdminDashboard /> : <AdminUsers />}
          </main>
        )}
      </div>
    );
  }

  // Victim PWA Routes
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col">
      <Navbar currentTab={currentTab} onNavigateTab={user?.role === 'admin' ? handleNavigateTab : undefined} />
      <OfflineBanner />

      <main className="flex-1">
        {!user ? (
          <VictimAuth onSuccess={refreshUser} />
        ) : activeIncidentId !== null ? (
          <VictimActiveSos
            incidentId={activeIncidentId}
            onResolved={() => {
              setActiveIncidentId(null);
              refreshUser();
            }}
          />
        ) : showSettings || contacts.length === 0 ? (
          <VictimOnboarding
            onComplete={() => {
              setShowSettings(false);
              refreshUser();
            }}
          />
        ) : (
          <VictimHome
            onSosTriggered={(id) => setActiveIncidentId(id)}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}
      </main>
    </div>
  );
};
