import React, { useState, useEffect } from 'react';
import { api } from '../../api/client.js';
import { Users, Watch, Clock, UserCheck } from 'lucide-react';

interface UserRecord {
  id: number;
  name: string;
  phone: string;
  role: string;
  created_at: string;
  device_id: string | null;
  sim_number: string | null;
  last_seen_at: string | null;
}

export const AdminUsers: React.FC = () => {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const data = await api.get<UserRecord[]>('/api/admin/users');
        setUsers(data);
      } catch (err) {
        console.warn('Failed to fetch user list:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-red-500" />
            Users & Hardware Bands Directory
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Registered safety system users and associated hardware band telemetry
          </p>
        </div>
        <span className="text-xs font-bold px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded-full text-slate-700 dark:text-slate-300">
          {users.length} Total Users
        </span>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading directory...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-5 py-3.5">User</th>
                  <th className="px-5 py-3.5">Role</th>
                  <th className="px-5 py-3.5">Phone / ID</th>
                  <th className="px-5 py-3.5">Paired Band</th>
                  <th className="px-5 py-3.5">Band SIM</th>
                  <th className="px-5 py-3.5">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="px-5 py-3.5 font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <UserCheck className="w-4 h-4 text-slate-400" />
                      {u.name}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${u.role === 'admin' ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-mono">{u.phone}</td>
                    <td className="px-5 py-3.5 font-mono">
                      {u.device_id ? (
                        <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-bold">
                          <Watch className="w-3.5 h-3.5" />
                          {u.device_id}
                        </span>
                      ) : (
                        <span className="text-slate-400">None</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-slate-500">
                      {u.sim_number || '—'}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">
                      {u.last_seen_at ? (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          {new Date(u.last_seen_at).toLocaleString()}
                        </span>
                      ) : (
                        'Never'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
