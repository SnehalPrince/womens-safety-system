import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { useSocket } from '../../context/SocketContext.js';
import { api } from '../../api/client.js';
import { wakeLock } from '../../utils/wakeLock.js';
import { MapComponent, MapLocationPoint } from '../../components/MapComponent.js';
import { ChatThread, ChatMessage } from '../../components/ChatThread.js';
import { Phone, MessageSquare, CheckCircle, ShieldAlert } from 'lucide-react';

interface VictimActiveSosProps {
  incidentId: number;
  onResolved: () => void;
}

export const VictimActiveSos: React.FC<VictimActiveSosProps> = ({ incidentId, onResolved }) => {
  const { contacts } = useAuth();
  const { socket } = useSocket();

  const [locations, setLocations] = useState<MapLocationPoint[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<'open' | 'acknowledged' | 'resolved'>('open');
  const [showSafeModal, setShowSafeModal] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [lastPostedTime, setLastPostedTime] = useState<Date | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const lastPostTimestampRef = useRef<number>(0);

  // 1. Keep Screen Awake via Wake Lock API
  useEffect(() => {
    wakeLock.request();
    return () => {
      wakeLock.release();
    };
  }, []);

  // 2. Load active incident state
  useEffect(() => {
    const fetchIncident = async () => {
      try {
        const res = await api.get<{
          active: boolean;
          incident: { id: number; status: 'open' | 'acknowledged' | 'resolved' };
          locations: MapLocationPoint[];
          messages: ChatMessage[];
        }>('/api/incidents/active');

        if (res.active && res.incident) {
          setStatus(res.incident.status);
          setLocations(res.locations || []);
          setMessages(res.messages || []);
        }
      } catch (err) {
        console.warn('Failed to load active incident:', err);
      }
    };

    fetchIncident();
  }, [incidentId]);

  // 3. Listen to Socket.IO events for live updates
  useEffect(() => {
    if (!socket) return;

    const handleLocation = (data: { incidentId: number; location: MapLocationPoint }) => {
      if (data.incidentId === incidentId) {
        setLocations((prev) => [...prev, data.location]);
      }
    };

    const handleStatus = (data: { incidentId: number; status: 'open' | 'acknowledged' | 'resolved' }) => {
      if (data.incidentId === incidentId) {
        setStatus(data.status);
        if (data.status === 'resolved') {
          onResolved();
        }
      }
    };

    const handleMessage = (data: { incidentId: number; message: ChatMessage }) => {
      if (data.incidentId === incidentId) {
        setMessages((prev) => [...prev, data.message]);
      }
    };

    socket.on('incident:location', handleLocation);
    socket.on('incident:status', handleStatus);
    socket.on('message:new', handleMessage);

    return () => {
      socket.off('incident:location', handleLocation);
      socket.off('incident:status', handleStatus);
      socket.off('message:new', handleMessage);
    };
  }, [socket, incidentId, onResolved]);

  // 4. Live Geolocation Watcher (High Accuracy, posting every 5s)
  useEffect(() => {
    if (!navigator.geolocation) return;

    const handlePosition = async (pos: GeolocationPosition) => {
      const now = Date.now();
      // Throttle posting to once every 5000 ms
      if (now - lastPostTimestampRef.current >= 4800) {
        lastPostTimestampRef.current = now;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;

        try {
          const newLoc = await api.post<MapLocationPoint>(`/api/incidents/${incidentId}/location`, {
            lat,
            lng,
            accuracy,
          });
          setLastPostedTime(new Date());
          setLocations((prev) => [...prev, newLoc]);
        } catch (err) {
          console.warn('Failed to post live location point:', err);
        }
      }
    };

    const handleError = (err: GeolocationPositionError) => {
      console.warn('Geolocation watch error:', err.message);
    };

    watchIdRef.current = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 10000,
    });

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [incidentId]);

  // 5. Send message from victim
  const handleSendMessage = async (body: string) => {
    const newMsg = await api.post<ChatMessage>(`/api/incidents/${incidentId}/messages`, { body });
    setMessages((prev) => [...prev, newMsg]);
  };

  // 6. Resolve Incident ("I'm Safe")
  const handleConfirmSafe = async () => {
    setIsResolving(true);
    try {
      await api.post(`/api/incidents/${incidentId}/resolve`);
      setShowSafeModal(false);
      onResolved();
    } catch (err: any) {
      alert(err.message || 'Failed to resolve incident');
    } finally {
      setIsResolving(false);
    }
  };

  // Generate fallback SMS URL for priority contacts
  const latestLoc = locations.length > 0 ? locations[locations.length - 1] : null;
  const mapsLink = latestLoc
    ? `https://maps.google.com/?q=${latestLoc.lat},${latestLoc.lng}`
    : 'GPS locating...';
  const phoneNumbers = contacts.map((c) => c.phone).join(',');
  const smsBody = encodeURIComponent(
    `EMERGENCY ALERT: I need immediate help! My live location: ${mapsLink}`
  );
  const smsUrl = `sms:${phoneNumbers}?body=${smsBody}`;

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Active Alert Banner */}
      <div className="bg-red-600 text-white rounded-3xl p-5 shadow-2xl animate-flash-alert border-2 border-red-500">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center animate-pulse">
              <ShieldAlert className="w-7 h-7 text-white" />
            </div>
            <div>
              <div className="text-xs uppercase font-extrabold tracking-widest text-red-200">
                {status === 'acknowledged' ? 'DISPATCH ACKNOWLEDGED' : 'SOS DISPATCH ACTIVE'}
              </div>
              <h1 className="text-xl font-black">Help Is Being Notified</h1>
            </div>
          </div>
          <span className="text-xs bg-white text-red-700 px-3 py-1 rounded-full font-black animate-pulse">
            LIVE
          </span>
        </div>

        <p className="text-xs text-red-100 mt-2">
          {status === 'acknowledged'
            ? 'Emergency team has acknowledged your alert and is responding.'
            : 'Your live location is streaming every 5 seconds. Responders & contacts are alerted.'}
        </p>
      </div>

      {/* Emergency Actions: Call 112 & SMS Fallback */}
      <div className="grid grid-cols-2 gap-3">
        <a
          href="tel:112"
          className="py-3.5 px-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-xs sm:text-sm shadow-md flex items-center justify-center gap-2 transition-transform active:scale-95"
        >
          <Phone className="w-4 h-4" />
          <span>Call Emergency (112)</span>
        </a>

        <a
          href={smsUrl}
          className="py-3.5 px-4 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 rounded-2xl font-bold text-xs sm:text-sm shadow-md flex items-center justify-center gap-2 transition-transform active:scale-95"
        >
          <MessageSquare className="w-4 h-4 text-emerald-400" />
          <span>SMS All Contacts</span>
        </a>
      </div>

      {/* Live Map */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 border border-slate-200 dark:border-slate-700 shadow-sm space-y-2">
        <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
          <span>Live Location Streaming</span>
          {lastPostedTime && (
            <span className="text-[11px] text-slate-500 font-normal">
              Updated {lastPostedTime.toLocaleTimeString()}
            </span>
          )}
        </div>
        <MapComponent locations={locations} height="280px" />
      </div>

      {/* Live Chat with Dispatch / Responders */}
      <div className="h-[340px]">
        <ChatThread
          messages={messages}
          currentRole="user"
          onSendMessage={handleSendMessage}
        />
      </div>

      {/* I'm Safe Resolution Button */}
      <div className="pt-2">
        <button
          type="button"
          onClick={() => setShowSafeModal(true)}
          className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm rounded-2xl shadow-xl shadow-emerald-600/20 flex items-center justify-center gap-2 transition-transform active:scale-98 cursor-pointer"
        >
          <CheckCircle className="w-5 h-5" />
          <span>I'm Safe (End Emergency)</span>
        </button>
      </div>

      {/* Confirmation Modal */}
      {showSafeModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-700 text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center text-emerald-600">
              <CheckCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Are you safe now?
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                This will resolve the alert, stop live GPS tracking, and notify the emergency responders and paired hardware band.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowSafeModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isResolving}
                onClick={handleConfirmSafe}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md cursor-pointer"
              >
                {isResolving ? 'Resolving...' : "Yes, I'm Safe"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
