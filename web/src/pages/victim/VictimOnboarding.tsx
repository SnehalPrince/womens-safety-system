import React, { useState } from 'react';
import { useAuth, Contact } from '../../context/AuthContext.js';
import { api } from '../../api/client.js';
import { Users, Watch, Plus, Trash2, CheckCircle2, ArrowRight, Shield } from 'lucide-react';

export const VictimOnboarding: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const { contacts, pairedDevice, refreshUser } = useAuth();

  // Contact form state
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cRelation, setCRelation] = useState('Parent');
  const [cPriority, setCPriority] = useState(1);
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  // Band pairing state
  const [deviceId, setDeviceId] = useState(pairedDevice?.device_id || 'band-001');
  const [simNumber, setSimNumber] = useState(pairedDevice?.sim_number || '');
  const [isPairing, setIsPairing] = useState(false);
  const [bandMessage, setBandMessage] = useState<string | null>(null);

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactError(null);
    if (!cName.trim() || !cPhone.trim()) {
      setContactError('Please enter both name and contact phone number');
      return;
    }

    setIsAddingContact(true);
    try {
      await api.post<Contact>('/api/contacts', {
        name: cName.trim(),
        phone: cPhone.trim(),
        relation: cRelation,
        priority: Number(cPriority),
      });
      setCName('');
      setCPhone('');
      await refreshUser();
    } catch (err: any) {
      setContactError(err.message || 'Failed to add emergency contact');
    } finally {
      setIsAddingContact(false);
    }
  };

  const handleDeleteContact = async (id: number) => {
    try {
      await api.del(`/api/contacts/${id}`);
      await refreshUser();
    } catch (err: any) {
      alert(err.message || 'Failed to delete contact');
    }
  };

  const handlePairBand = async (e: React.FormEvent) => {
    e.preventDefault();
    setBandMessage(null);
    if (!deviceId.trim()) return;

    setIsPairing(true);
    try {
      await api.post('/api/devices/pair', {
        deviceId: deviceId.trim(),
        simNumber: simNumber.trim() || undefined,
      });
      setBandMessage('Hardware band successfully paired!');
      await refreshUser();
    } catch (err: any) {
      setBandMessage(`Pairing failed: ${err.message}`);
    } finally {
      setIsPairing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Onboarding Header */}
      <div className="bg-gradient-to-r from-red-600 to-rose-600 rounded-3xl p-6 text-white shadow-xl">
        <div className="flex items-center gap-3 mb-2">
          <Shield className="w-8 h-8 opacity-90" />
          <h1 className="text-2xl font-bold tracking-tight">Emergency Setup</h1>
        </div>
        <p className="text-xs sm:text-sm text-red-100 max-w-lg">
          Add your trusted emergency contacts and pair your wearable hardware band so responders can act immediately.
        </p>
      </div>

      {/* Step 1: Emergency Contacts (Max 5) */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-red-600 dark:text-red-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Emergency Contacts ({contacts.length}/5)
            </h2>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">Min 1, Max 5</span>
        </div>

        {/* Existing Contacts List */}
        {contacts.length > 0 ? (
          <div className="space-y-2">
            {contacts.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm"
              >
                <div>
                  <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    {c.name}
                    <span className="text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 px-2 py-0.5 rounded-full">
                      Priority #{c.priority}
                    </span>
                  </div>
                  <div className="text-slate-500 dark:text-slate-400 text-xs">
                    {c.relation} • {c.phone}
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteContact(c.id)}
                  className="text-slate-400 hover:text-red-600 p-2 rounded-lg transition-colors cursor-pointer"
                  title="Remove contact"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic">No emergency contacts registered yet.</p>
        )}

        {/* Add Contact Form (if < 5) */}
        {contacts.length < 5 && (
          <form onSubmit={handleAddContact} className="pt-3 border-t border-slate-100 dark:border-slate-700/60 space-y-3">
            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              Add New Contact
            </h3>
            {contactError && (
              <p className="text-xs text-red-600 dark:text-red-400">{contactError}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Contact Name (e.g. Mom)"
                value={cName}
                onChange={(e) => setCName(e.target.value)}
                className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-red-500 dark:text-white"
              />
              <input
                type="text"
                placeholder="Phone Number"
                value={cPhone}
                onChange={(e) => setCPhone(e.target.value)}
                className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-red-500 dark:text-white"
              />
              <select
                value={cRelation}
                onChange={(e) => setCRelation(e.target.value)}
                className="px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-red-500 dark:text-white"
              >
                <option value="Parent">Parent</option>
                <option value="Spouse">Spouse / Partner</option>
                <option value="Sibling">Sibling</option>
                <option value="Friend">Close Friend</option>
                <option value="Guardian">Guardian</option>
                <option value="Colleague">Colleague</option>
              </select>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Priority:</span>
                <select
                  value={cPriority}
                  onChange={(e) => setCPriority(Number(e.target.value))}
                  className="flex-1 px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-red-500 dark:text-white"
                >
                  <option value={1}>1 (First called)</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={isAddingContact}
              className="w-full sm:w-auto px-5 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{isAddingContact ? 'Adding...' : 'Save Emergency Contact'}</span>
            </button>
          </form>
        )}
      </div>

      {/* Step 2: Pair Hardware Band */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Watch className="w-5 h-5 text-red-600 dark:text-red-400" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Hardware Band Pairing
          </h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Pair your ESP8266 + GPS wearable band to trigger alerts silently and receive remote commands.
        </p>

        {pairedDevice && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-800 dark:text-emerald-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>Currently Paired: <strong>{pairedDevice.device_id}</strong></span>
            </div>
            {pairedDevice.last_seen_at && (
              <span className="text-[10px] opacity-80">
                Last seen: {new Date(pairedDevice.last_seen_at).toLocaleTimeString()}
              </span>
            )}
          </div>
        )}

        <form onSubmit={handlePairBand} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Band Device ID
              </label>
              <input
                type="text"
                required
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                placeholder="e.g. band-001"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-red-500 dark:text-white font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Band SIM Number (Optional for SMS fallback)
              </label>
              <input
                type="text"
                value={simNumber}
                onChange={(e) => setSimNumber(e.target.value)}
                placeholder="e.g. +919876543210"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-red-500 dark:text-white"
              />
            </div>
          </div>

          {bandMessage && (
            <p className="text-xs text-slate-700 dark:text-slate-300">{bandMessage}</p>
          )}

          <button
            type="submit"
            disabled={isPairing}
            className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-900 dark:text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>{isPairing ? 'Pairing...' : pairedDevice ? 'Update Pairing' : 'Pair Device'}</span>
          </button>
        </form>
      </div>

      {/* Done / Continue Button */}
      <div className="pt-2">
        <button
          onClick={onComplete}
          disabled={contacts.length === 0}
          className="w-full py-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-black rounded-2xl shadow-xl shadow-red-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer text-sm"
        >
          <span>{contacts.length === 0 ? 'Add at least 1 contact to continue' : 'Proceed to Emergency Dashboard'}</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
