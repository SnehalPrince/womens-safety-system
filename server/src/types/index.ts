export type UserRole = 'user' | 'admin';

export interface User {
  id: number;
  name: string;
  phone: string;
  password_hash: string;
  role: UserRole;
  created_at: string | Date;
}

export interface Contact {
  id: number;
  user_id: number;
  name: string;
  phone: string;
  relation: string;
  priority: number;
  created_at: string | Date;
}

export interface Device {
  device_id: string;
  user_id: number;
  sim_number: string | null;
  last_seen_at: string | Date | null;
  paired_at: string | Date;
}

export interface DeviceCommand {
  id: number;
  device_id: string;
  command: 'sos' | 'stop';
  created_at: string | Date;
  consumed_at: string | Date | null;
}

export type IncidentStatus = 'open' | 'acknowledged' | 'resolved' | 'cancelled';
export type IncidentSource = 'app' | 'band';

export interface Incident {
  id: number;
  user_id: number;
  status: IncidentStatus;
  source: IncidentSource;
  started_at: string | Date;
  acknowledged_by: number | null;
  resolved_at: string | Date | null;
  notes: string | null;
}

export interface LocationPoint {
  id: number;
  incident_id: number;
  lat: number;
  lng: number;
  accuracy: number | null;
  source: IncidentSource;
  recorded_at: string | Date;
}

export interface Message {
  id: number;
  incident_id: number;
  sender: 'admin' | 'user';
  body: string;
  created_at: string | Date;
}

export interface AuthTokenPayload {
  userId: number;
  role: UserRole;
  phone: string;
}
