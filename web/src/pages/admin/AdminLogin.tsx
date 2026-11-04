import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { Shield, Lock, Mail, AlertCircle, ArrowRight } from 'lucide-react';

export const AdminLogin: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const user = await login(email.trim(), password);
      if (user.role !== 'admin') {
        throw new Error('Access denied: This portal is restricted to Emergency Administrators.');
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Login failed. Please verify admin credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-slate-900 dark:bg-slate-700 flex items-center justify-center text-red-500 shadow-md">
            <Shield className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">
            Emergency Dispatch Portal
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Authorised emergency personnel and incident response only
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Admin Identifier / Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@safety.local"
                className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-red-500 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-red-500 dark:text-white"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-3.5 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-red-600 dark:hover:bg-red-700 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all cursor-pointer text-sm"
          >
            <span>{isLoading ? 'Verifying...' : 'Sign In to Dispatch Console'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
