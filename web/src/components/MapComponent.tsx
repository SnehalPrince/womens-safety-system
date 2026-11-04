import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import { ExternalLink, Navigation } from 'lucide-react';

export interface MapLocationPoint {
  id?: number;
  lat: number;
  lng: number;
  accuracy?: number | null;
  recorded_at?: string;
  source?: string;
}

interface MapComponentProps {
  locations: MapLocationPoint[];
  victimName?: string;
  height?: string;
}

// Controller component to smoothly pan/re-center map as location moves
const MapCenterUpdater: React.FC<{ center: [number, number] }> = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    map.panTo(center, { animate: true, duration: 0.8 });
  }, [center[0], center[1], map]);
  return null;
};

// Custom SVG Pulsing Marker Icon
const createCustomIcon = (isCurrent = true) => {
  const color = isCurrent ? '#dc2626' : '#64748b';
  const html = `
    <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px;">
      ${isCurrent ? '<div style="position: absolute; width: 32px; height: 32px; border-radius: 50%; background: rgba(220, 38, 38, 0.4); animation: pulse-ring 2s infinite;"></div>' : ''}
      <div style="width: 16px; height: 16px; border-radius: 50%; background: ${color}; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); z-index: 2;"></div>
    </div>
  `;
  return L.divIcon({
    html,
    className: 'custom-leaflet-marker',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

export const MapComponent: React.FC<MapComponentProps> = ({
  locations,
  victimName = 'Victim',
  height = '350px',
}) => {
  // Fallback center: default New Delhi (matching band-001 simulation default) or first location
  const currentLoc = locations.length > 0 ? locations[locations.length - 1] : null;
  const center: [number, number] = useMemo(() => {
    return currentLoc ? [currentLoc.lat, currentLoc.lng] : [28.6139, 77.2090];
  }, [currentLoc?.lat, currentLoc?.lng]);

  const polylineCoords: [number, number][] = useMemo(() => {
    return locations.map((loc) => [loc.lat, loc.lng]);
  }, [locations]);

  const currentIcon = useMemo(() => createCustomIcon(true), []);
  const historicalIcon = useMemo(() => createCustomIcon(false), []);

  const googleMapsUrl = currentLoc
    ? `https://www.google.com/maps/search/?api=1&query=${currentLoc.lat},${currentLoc.lng}`
    : `https://www.google.com/maps/search/?api=1&query=28.6139,77.2090`;

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm" style={{ height }}>
      {/* Floating Action: Open in Google Maps */}
      <div className="absolute top-3 right-3 z-[1000] flex items-center gap-2">
        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-white/90 dark:bg-slate-900/90 hover:bg-white dark:hover:bg-slate-900 text-slate-800 dark:text-slate-100 text-xs font-semibold px-3 py-1.5 rounded-lg shadow-md border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 backdrop-blur-sm transition-all"
        >
          <ExternalLink className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span>Open in Google Maps</span>
        </a>
      </div>

      {/* Coordinate HUD */}
      {currentLoc && (
        <div className="absolute bottom-3 left-3 z-[1000] bg-slate-900/80 text-white text-[11px] font-mono px-2.5 py-1 rounded-md backdrop-blur-sm flex items-center gap-2">
          <Navigation className="w-3 h-3 text-red-400 animate-spin" />
          <span>{currentLoc.lat.toFixed(6)}, {currentLoc.lng.toFixed(6)}</span>
          {currentLoc.accuracy && <span className="opacity-75">(±{Math.round(currentLoc.accuracy)}m)</span>}
        </div>
      )}

      <MapContainer
        center={center}
        zoom={16}
        scrollWheelZoom={false}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapCenterUpdater center={center} />

        {/* Breadcrumb Trail */}
        {polylineCoords.length > 1 && (
          <Polyline
            positions={polylineCoords}
            pathOptions={{ color: '#ef4444', weight: 4, opacity: 0.7, dashArray: '8, 8' }}
          />
        )}

        {/* Accuracy Circle around latest location */}
        {currentLoc && currentLoc.accuracy && currentLoc.accuracy > 0 && (
          <Circle
            center={[currentLoc.lat, currentLoc.lng]}
            radius={currentLoc.accuracy}
            pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.15, weight: 1 }}
          />
        )}

        {/* Older Breadcrumb Markers */}
        {locations.slice(0, -1).map((loc, idx) => (
          <Marker key={loc.id || idx} position={[loc.lat, loc.lng]} icon={historicalIcon}>
            <Popup>
              <div className="text-xs">
                <strong>Historical Point #{idx + 1}</strong>
                <div>Time: {loc.recorded_at ? new Date(loc.recorded_at).toLocaleTimeString() : 'N/A'}</div>
                <div>Source: {loc.source}</div>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Active Current Location Marker */}
        {currentLoc && (
          <Marker position={[currentLoc.lat, currentLoc.lng]} icon={currentIcon}>
            <Popup>
              <div className="text-xs">
                <strong className="text-red-600 font-bold">{victimName} (Live)</strong>
                <div>Coords: {currentLoc.lat.toFixed(5)}, {currentLoc.lng.toFixed(5)}</div>
                <div>Source: {currentLoc.source}</div>
                <div>Updated: {currentLoc.recorded_at ? new Date(currentLoc.recorded_at).toLocaleTimeString() : 'Just now'}</div>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
};
