import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../api/client.js';
import { SosProgressButton } from '../../components/SosProgressButton.js';
import { Users, Watch, Settings, AlertTriangle, ShieldCheck, Info } from 'lucide-react';

interface VictimHomeProps {
  onSosTriggered: (incidentId: number) => void;
  onOpenSettings: () => void;
}

export const VictimHome: React.FC<VictimHomeProps> = ({ onSosTriggered, onOpenSettings }) => {
  const { contacts, pairedDevice } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSosTrigger = async () => {
    setIsSubmitting(true);
    setError(null);

    // Retrieve geolocation
    const getPosition = (): Promise<GeolocationPosition> => {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation not supported by device'));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        });
      });
    };

    let lat = 28.6139; // fallback coordinate if GPS unavailable
    let lng = 77.2090;
    let accuracy = 20;

    try {
      const pos = await getPosition();
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
      accuracy = pos.coords.accuracy;
    } catch (gpsErr) {
      console.warn('GPS location unavailable, using baseline location:', gpsErr);
    }

    try {
      const res = await api.post<{ incident: { id: number } }>('/api/sos', {
        lat,
        lng,
        accuracy,
      });
      onSosTriggered(res.incident.id);
    } catch (err: any) {
      setError(err.message || 'Failed to dispatch SOS alert. Please try SMS fallback.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto p-4 sm:p-6 space-y-6 flex flex-col justify-between min-h-[calc(100vh-5rem)]">
      {/* Top Banner / Greeting */}
      <div className="text-center pt-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
          <ShieldCheck className="w-3.5 h-3.5" /> Ready & Protected
        </span>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white mt-2">
          Emergency SOS
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          In distress? Press and hold the button below for 3 seconds.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-200 rounded-xl text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Action: 3s Hold SOS Button */}
      <div className="flex-1 flex items-center justify-center">
        <SosProgressButton onTrigger={handleSosTrigger} disabled={isSubmitting} />
      </div>

      {/* Hardware & Emergency Status Card */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
        <div className="grid grid-cols-2 gap-3 text-xs">
          {/* Contacts Pill */}
          <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
              <Users className="w-4 h-4 text-red-500" />
              <span className="font-semibold">Contacts</span>
            </div>
            <div className="font-bold text-slate-900 dark:text-white text-sm">
              {contacts.length} Registered
            </div>
          </div>

          {/* Band Pill */}
          <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-1">
              <Watch className="w-4 h-4 text-blue-500" />
              <span className="font-semibold">Hardware Band</span>
            </div>
            <div className="font-bold text-slate-900 dark:text-white text-sm font-mono truncate">
              {pairedDevice ? pairedDevice.device_id : 'Not Paired'}
            </div>
          </div>
        </div>

        {/* Quick Settings Link */}
        <button
          onClick={onOpenSettings}
          className="w-full py-2.5 px-4 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <Settings className="w-4 h-4" />
          <span>Configure Contacts & Hardware Band</span>
        </button>

        {/* PWA Background Location Notice */}
        <div className="p-2.5 bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-900/50 flex items-start gap-2 text-[11px] text-amber-800 dark:text-amber-300">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div>
            <strong>Browser PWA Notice:</strong> When the screen is turned off, some mobile browsers throttle background location updates. Keep this screen on or use the wearable band for continuous satellite tracking.
          </div>
        </div>
      </div>
    </div>
  );
};
