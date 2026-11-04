import React, { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../../context/SocketContext.js';
import { api } from '../../api/client.js';
import { alarmSound } from '../../utils/sound.js';
import { requestNotificationPermission, showIncidentNotification } from '../../utils/notifications.js';
import { MapComponent, MapLocationPoint } from '../../components/MapComponent.js';
import { ChatThread, ChatMessage } from '../../components/ChatThread.js';
import {
  Bell,
  BellOff,
  ShieldAlert,
  Phone,
  MessageSquare,
  CheckCircle,
  Eye,
  Watch,
  Smartphone,
  ExternalLink,
  Users,
  Clock
} from 'lucide-react';

interface IncidentSummary {
  id: number;
  user_id: number;
  status: 'open' | 'acknowledged' | 'resolved' | 'cancelled';
  source: 'app' | 'band';
  started_at: string;
  acknowledged_by: number | null;
  resolved_at: string | null;
  notes: string | null;
  user_name: string;
  user_phone: string;
  last_lat: number | null;
  last_lng: number | null;
  last_location_at: string | null;
}

interface IncidentDetail {
  incident: IncidentSummary;
  victim: {
    id: number;
    name: string;
    phone: string;
    created_at: string;
  };
  contacts: Array<{
    id: number;
    name: string;
    phone: string;
    relation: string;
    priority: number;
  }>;
  devices: Array<{
    device_id: string;
    sim_number: string | null;
    last_seen_at: string | null;
  }>;
  locations: MapLocationPoint[];
  messages: ChatMessage[];
}

export const AdminDashboard: React.FC = () => {
  const { socket } = useSocket();

  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<IncidentDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [alertsArmed, setAlertsArmed] = useState(false);
  const [isAlarmSounding, setIsAlarmSounding] = useState(false);
  const [notesInput, setNotesInput] = useState('');
  const [isActionPending, setIsActionPending] = useState(false);

  // Arm audio & browser notifications on user click
  const handleArmAlerts = async () => {
    const audioOk = alarmSound.arm();
    const notifOk = await requestNotificationPermission();
    setAlertsArmed(true);
    if (!audioOk && !notifOk) {
      alert('Alerts armed. (Note: enable permissions if browser prompted)');
    }
  };

  const handleStopAlarm = () => {
    alarmSound.stop();
    setIsAlarmSounding(false);
  };

  // Fetch incidents list
  const fetchIncidents = useCallback(async () => {
    try {
      const url = statusFilter === 'all' ? '/api/admin/incidents' : `/api/admin/incidents?status=${statusFilter}`;
      const list = await api.get<IncidentSummary[]>(url);
      setIncidents(list);

      // Auto-select first active incident if none selected
      if (!selectedId && list.length > 0) {
        setSelectedId(list[0].id);
      }
    } catch (err) {
      console.warn('Failed to load admin incidents:', err);
    }
  }, [statusFilter, selectedId]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  // Fetch detailed view for selected incident
  const fetchIncidentDetail = useCallback(async (id: number) => {
    try {
      const detail = await api.get<IncidentDetail>(`/api/admin/incidents/${id}`);
      setSelectedDetail(detail);
      setNotesInput(detail.incident.notes || '');
    } catch (err) {
      console.warn('Failed to fetch incident detail:', err);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      fetchIncidentDetail(selectedId);
    }
  }, [selectedId, fetchIncidentDetail]);

  // Real-time Socket.IO listeners
  useEffect(() => {
    if (!socket) return;

    const handleIncidentNew = (data: { incident: IncidentSummary; user: any; location?: any }) => {
      // Play siren alarm
      alarmSound.play();
      setIsAlarmSounding(true);

      // Show native desktop notification
      showIncidentNotification(
        '🚨 EMERGENCY SOS ALERT',
        `Victim: ${data.user?.name || 'Unknown'} has triggered SOS (${data.incident?.source || 'App'})!`
      );

      // Update incident list: place at top
      setIncidents((prev) => [
        {
          ...data.incident,
          user_name: data.user?.name || 'Unknown',
          user_phone: data.user?.phone || 'Unknown',
          last_lat: data.location?.lat ?? null,
          last_lng: data.location?.lng ?? null,
          last_location_at: data.location?.recorded_at ?? new Date().toISOString(),
        },
        ...prev.filter((i) => i.id !== data.incident.id),
      ]);

      // Auto-focus on new incident
      setSelectedId(data.incident.id);
    };

    const handleIncidentLocation = (data: { incidentId: number; location: MapLocationPoint }) => {
      setIncidents((prev) =>
        prev.map((inc) =>
          inc.id === data.incidentId
            ? {
                ...inc,
                last_lat: data.location.lat,
                last_lng: data.location.lng,
                last_location_at: data.location.recorded_at || new Date().toISOString(),
              }
            : inc
        )
      );

      // If viewing this incident, append to map trail
      setSelectedDetail((prev) => {
        if (!prev || prev.incident.id !== data.incidentId) return prev;
        return {
          ...prev,
          locations: [...prev.locations, data.location],
        };
      });
    };

    const handleIncidentStatus = (data: { incidentId: number; status: 'open' | 'acknowledged' | 'resolved' | 'cancelled'; notes?: string }) => {
      // Stop alarm if current incident is acknowledged or resolved
      alarmSound.stop();
      setIsAlarmSounding(false);

      setIncidents((prev) =>
        prev.map((inc) =>
          inc.id === data.incidentId ? { ...inc, status: data.status, notes: data.notes ?? inc.notes } : inc
        )
      );

      setSelectedDetail((prev) => {
        if (!prev || prev.incident.id !== data.incidentId) return prev;
        return {
          ...prev,
          incident: { ...prev.incident, status: data.status, notes: data.notes ?? prev.incident.notes },
        };
      });
    };

    const handleMessageNew = (data: { incidentId: number; message: ChatMessage }) => {
      setSelectedDetail((prev) => {
        if (!prev || prev.incident.id !== data.incidentId) return prev;
        return {
          ...prev,
          messages: [...prev.messages, data.message],
        };
      });
    };

    socket.on('incident:new', handleIncidentNew);
    socket.on('incident:location', handleIncidentLocation);
    socket.on('incident:status', handleIncidentStatus);
    socket.on('message:new', handleMessageNew);

    return () => {
      socket.off('incident:new', handleIncidentNew);
      socket.off('incident:location', handleIncidentLocation);
      socket.off('incident:status', handleIncidentStatus);
      socket.off('message:new', handleMessageNew);
    };
  }, [socket]);

  // Actions
  const handleAcknowledge = async () => {
    if (!selectedId) return;
    setIsActionPending(true);
    try {
      await api.post(`/api/admin/incidents/${selectedId}/acknowledge`);
      handleStopAlarm();
      await fetchIncidents();
      await fetchIncidentDetail(selectedId);
    } catch (err: any) {
      alert(err.message || 'Failed to acknowledge incident');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleResolve = async () => {
    if (!selectedId) return;
    setIsActionPending(true);
    try {
      await api.post(`/api/admin/incidents/${selectedId}/resolve`, {
        notes: notesInput.trim() || 'Resolved by emergency dispatch center',
      });
      handleStopAlarm();
      await fetchIncidents();
      await fetchIncidentDetail(selectedId);
    } catch (err: any) {
      alert(err.message || 'Failed to resolve incident');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleSendMessage = async (body: string) => {
    if (!selectedId) return;
    const newMsg = await api.post<ChatMessage>(`/api/admin/incidents/${selectedId}/messages`, { body });
    setSelectedDetail((prev) => {
      if (!prev) return prev;
      return { ...prev, messages: [...prev.messages, newMsg] };
    });
  };

  const cleanPhone = (phone: string) => phone.replace(/[^\d+]/g, '');

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Top Banner & Audio Siren Controller */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-800 p-4 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-red-600 text-white flex items-center justify-center shadow-md shadow-red-600/30">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
              Emergency Dispatch Console
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                {incidents.filter((i) => i.status === 'open' || i.status === 'acknowledged').length} Active
              </span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Live GPS telemetry, instant contact dialing, and hardware band telemetry
            </p>
          </div>
        </div>

        {/* Alerts Arming Button */}
        <div className="flex items-center gap-2">
          {isAlarmSounding && (
            <button
              onClick={handleStopAlarm}
              className="px-4 py-2 bg-red-600 text-white font-bold text-xs rounded-xl animate-pulse shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <BellOff className="w-4 h-4" />
              <span>Silence Alarm Siren</span>
            </button>
          )}

          {!alertsArmed ? (
            <button
              onClick={handleArmAlerts}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 cursor-pointer transition-colors"
            >
              <Bell className="w-4 h-4 text-amber-400" />
              <span>Enable Live Siren & Push Alerts</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-xs font-semibold border border-emerald-200 dark:border-emerald-800">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Alerts Armed (Audio & Push)
            </span>
          )}
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-[700px]">
        {/* Left Column: Incidents List (4 Cols) */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col overflow-hidden">
          {/* Filter Bar */}
          <div className="p-3.5 border-b border-slate-100 dark:border-slate-700 flex items-center gap-1.5 overflow-x-auto text-xs">
            {['all', 'open', 'acknowledged', 'resolved'].map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`px-3 py-1.5 rounded-xl font-semibold capitalize whitespace-nowrap transition-colors cursor-pointer ${
                  statusFilter === f
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* List of Incidents */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/50 p-2 space-y-1">
            {incidents.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">
                No incidents found in this category.
              </div>
            ) : (
              incidents.map((inc) => {
                const isSelected = inc.id === selectedId;
                const isOpen = inc.status === 'open';
                const isAck = inc.status === 'acknowledged';

                return (
                  <button
                    key={inc.id}
                    onClick={() => setSelectedId(inc.id)}
                    className={`w-full text-left p-3.5 rounded-2xl transition-all cursor-pointer flex flex-col gap-1.5 ${
                      isSelected
                        ? 'bg-red-50/70 dark:bg-red-950/30 border-2 border-red-500 shadow-sm'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-700/40 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                        {inc.user_name}
                      </span>
                      <span
                        className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                          isOpen
                            ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 animate-pulse'
                            : isAck
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}
                      >
                        {inc.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="flex items-center gap-1">
                        {inc.source === 'band' ? (
                          <Watch className="w-3.5 h-3.5 text-blue-500" />
                        ) : (
                          <Smartphone className="w-3.5 h-3.5 text-red-500" />
                        )}
                        <span className="capitalize">{inc.source}</span>
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(inc.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span>•</span>
                      <span>{inc.user_phone}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Incident Detail View (8 Cols) */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 flex flex-col space-y-5">
          {selectedDetail ? (
            <>
              {/* Detail Header & Action Buttons */}
              <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-700">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-black text-slate-900 dark:text-white">
                      {selectedDetail.victim.name}
                    </h2>
                    <span
                      className={`text-[11px] font-extrabold uppercase px-2.5 py-0.5 rounded-full ${
                        selectedDetail.incident.status === 'open'
                          ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 animate-pulse'
                          : selectedDetail.incident.status === 'acknowledged'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      }`}
                    >
                      {selectedDetail.incident.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1">
                    <span>Phone: {selectedDetail.victim.phone}</span>
                    <span>•</span>
                    <span>Triggered: {new Date(selectedDetail.incident.started_at).toLocaleString()}</span>
                    <span>•</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      Source: {selectedDetail.incident.source.toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Main Admin Incident Actions */}
                <div className="flex items-center gap-2">
                  <a
                    href={`tel:${cleanPhone(selectedDetail.victim.phone)}`}
                    className="py-2.5 px-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow flex items-center gap-1.5 transition-colors"
                  >
                    <Phone className="w-4 h-4" />
                    <span>Call Victim</span>
                  </a>

                  {selectedDetail.incident.status === 'open' && (
                    <button
                      onClick={handleAcknowledge}
                      disabled={isActionPending}
                      className="py-2.5 px-3.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold shadow flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Eye className="w-4 h-4" />
                      <span>Acknowledge</span>
                    </button>
                  )}

                  {selectedDetail.incident.status !== 'resolved' && (
                    <button
                      onClick={handleResolve}
                      disabled={isActionPending}
                      className="py-2.5 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <CheckCircle className="w-4 h-4" />
                      <span>Resolve & Clear</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Map & Emergency Contacts Grid */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                {/* Real-time Map (7 cols) */}
                <div className="md:col-span-7 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                    <span>Live Telemetry & Breadcrumbs</span>
                    <span className="text-[11px] font-normal text-slate-500">
                      {selectedDetail.locations.length} tracked points
                    </span>
                  </div>
                  <MapComponent
                    locations={selectedDetail.locations}
                    victimName={selectedDetail.victim.name}
                    height="320px"
                  />
                </div>

                {/* Emergency Contacts List (5 cols) */}
                <div className="md:col-span-5 bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-red-500" />
                      <h3 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider">
                        Priority Contacts ({selectedDetail.contacts.length})
                      </h3>
                    </div>
                  </div>

                  {selectedDetail.contacts.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No emergency contacts listed.</p>
                  ) : (
                    <div className="space-y-2 max-h-[280px] overflow-y-auto">
                      {selectedDetail.contacts.map((c) => {
                        const cleanP = cleanPhone(c.phone);
                        const waUrl = `https://wa.me/${cleanP.replace('+', '')}?text=${encodeURIComponent(
                          `Emergency Alert: Incident active for ${selectedDetail.victim.name}. Please respond immediately.`
                        )}`;

                        return (
                          <div
                            key={c.id}
                            className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-xs shadow-sm space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-900 dark:text-white">{c.name}</span>
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                                Priority #{c.priority}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {c.relation} • {c.phone}
                            </div>

                            {/* Direct Action Dialers */}
                            <div className="flex items-center gap-1.5 pt-1">
                              <a
                                href={`tel:${cleanP}`}
                                className="flex-1 py-1.5 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 text-blue-700 dark:text-blue-300 font-semibold rounded-lg text-center flex items-center justify-center gap-1 text-[11px]"
                              >
                                <Phone className="w-3 h-3" /> Call
                              </a>
                              <a
                                href={`sms:${cleanP}`}
                                className="flex-1 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 font-semibold rounded-lg text-center flex items-center justify-center gap-1 text-[11px]"
                              >
                                <MessageSquare className="w-3 h-3" /> SMS
                              </a>
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 py-1.5 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 font-semibold rounded-lg text-center flex items-center justify-center gap-1 text-[11px]"
                              >
                                <ExternalLink className="w-3 h-3" /> WhatsApp
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom: Live Dispatch Chat & Incident Notes */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                {/* Live Chat with Victim (7 cols) */}
                <div className="md:col-span-7 h-[280px]">
                  <ChatThread
                    messages={selectedDetail.messages}
                    currentRole="admin"
                    onSendMessage={handleSendMessage}
                  />
                </div>

                {/* Notes & Timeline (5 cols) */}
                <div className="md:col-span-5 bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider mb-2">
                      Incident Dispatch Notes
                    </h3>
                    <textarea
                      rows={6}
                      value={notesInput}
                      onChange={(e) => setNotesInput(e.target.value)}
                      placeholder="Enter emergency responder actions, police dispatch ID, or resolution findings..."
                      className="w-full p-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-red-500 dark:text-white"
                    />
                  </div>

                  <div className="pt-2 text-[11px] text-slate-500 flex items-center justify-between">
                    <span>Paired Band: {selectedDetail.devices[0]?.device_id || 'None'}</span>
                    <span>Notes saved on resolution</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center py-24 text-slate-400">
              <ShieldAlert className="w-12 h-12 opacity-30 mb-2" />
              <p className="text-sm font-semibold">Select an incident from the left to view telemetry</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
