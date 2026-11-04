import React, { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

export const OfflineBanner: React.FC = () => {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="bg-amber-600 text-white px-4 py-2.5 shadow-md flex items-center justify-between text-xs sm:text-sm font-medium z-50 sticky top-16 animate-pulse"
    >
      <div className="flex items-center gap-2 max-w-7xl mx-auto">
        <WifiOff className="w-5 h-5 flex-shrink-0" />
        <span>
          <strong>You are currently offline.</strong> The app will automatically retry sending SOS updates, or use the direct SMS emergency fallback below.
        </span>
      </div>
    </div>
  );
};
