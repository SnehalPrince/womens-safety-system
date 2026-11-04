import React from 'react';
import { useAuth } from '../context/AuthContext.js';
import { Shield, Moon, Sun, LogOut } from 'lucide-react';
import { useSocket } from '../context/SocketContext.js';

interface NavbarProps {
  currentTab?: 'app' | 'admin';
  onNavigateTab?: (tab: 'app' | 'admin') => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab = 'app', onNavigateTab }) => {
  const { user, logout, darkMode, toggleDarkMode } = useAuth();
  const { isConnected } = useSocket();

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-md bg-white/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-red-600 to-rose-500 flex items-center justify-center text-white shadow-md shadow-red-500/20">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <span className="font-bold text-lg tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              Guardian SOS
              {isConnected ? (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse" />
                  Live
                </span>
              ) : (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  Connecting...
                </span>
              )}
            </span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 -mt-0.5">
              Personal Safety & Hardware Band Integration
            </p>
          </div>
        </div>

        {/* Center Navigation if admin */}
        {user?.role === 'admin' && onNavigateTab && (
          <div className="hidden sm:flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
            <button
              onClick={() => onNavigateTab('app')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                currentTab === 'app'
                  ? 'bg-white dark:bg-slate-700 text-red-600 dark:text-red-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              Victim App (PWA)
            </button>
            <button
              onClick={() => onNavigateTab('admin')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                currentTab === 'admin'
                  ? 'bg-white dark:bg-slate-700 text-red-600 dark:text-red-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              Admin Live Panel
            </button>
          </div>
        )}

        {/* Right side controls */}
        <div className="flex items-center gap-2">
          {/* Dark mode toggle */}
          <button
            onClick={toggleDarkMode}
            aria-label="Toggle dark mode"
            className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

          {/* User info */}
          {user && (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
              <div className="hidden md:block text-right">
                <div className="text-xs font-medium text-slate-900 dark:text-slate-100">{user.name}</div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">{user.role}</div>
              </div>
              <button
                onClick={logout}
                title="Sign out"
                className="p-2 text-slate-500 hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
