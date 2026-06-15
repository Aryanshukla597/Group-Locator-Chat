import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getMemberColor } from "@/lib/utils";

// Fix leaflet default icon
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";

// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
});

export interface MapMember {
  memberId: string;
  memberName: string;
  latitude: number;
  longitude: number;
  isSharing: boolean;
  isSos?: boolean;
}

export interface MapMeetingPoint {
  latitude: number;
  longitude: number;
  label?: string | null;
}

interface MapViewProps {
  members: MapMember[];
  myMemberId: string;
  meetingPoint: MapMeetingPoint | null;
  onMapClick?: (lat: number, lng: number) => void;
  settingMeetingPoint?: boolean;
}

export default function MapView({ members, myMemberId, meetingPoint, onMapClick, settingMeetingPoint }: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const meetingMarkerRef = useRef<L.Marker | null>(null);
  const initialFitRef = useRef(false);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 3,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      meetingMarkerRef.current = null;
      initialFitRef.current = false;
    };
  }, []);

  // Map click handler
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handler = (e: L.LeafletMouseEvent) => {
      if (settingMeetingPoint && onMapClick) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    };

    map.on("click", handler);
    if (settingMeetingPoint) {
      map.getContainer().style.cursor = "crosshair";
    } else {
      map.getContainer().style.cursor = "";
    }

    return () => {
      map.off("click", handler);
      if (map.getContainer()) map.getContainer().style.cursor = "";
    };
  }, [settingMeetingPoint, onMapClick]);

  // Update member markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const activeIds = new Set<string>();

    members.forEach((member, idx) => {
      if (!member.isSharing) {
        if (markersRef.current.has(member.memberId)) {
          markersRef.current.get(member.memberId)!.remove();
          markersRef.current.delete(member.memberId);
        }
        return;
      }

      activeIds.add(member.memberId);
      const color = member.isSos ? "#ef4444" : getMemberColor(idx);
      const isMe = member.memberId === myMemberId;
      const initials = member.memberName.slice(0, 2).toUpperCase();
      const size = isMe ? 38 : 32;

      const icon = L.divIcon({
        className: member.isSos ? "sos-pulse" : "",
        html: `
          <div style="
            width:${size}px;height:${size}px;
            border-radius:50%;
            background:${color};
            border:${isMe ? "3px" : "2px"} solid white;
            box-shadow:0 2px 8px rgba(0,0,0,0.5)${isMe ? ",0 0 0 3px " + color + "55" : ""};
            display:flex;align-items:center;justify-content:center;
            font-weight:700;font-size:${isMe ? "12px" : "10px"};
            color:white;font-family:Inter,sans-serif;
            position:relative;
          ">
            ${initials}
            ${isMe ? '<div style="position:absolute;bottom:-2px;right:-2px;width:8px;height:8px;border-radius:50%;background:#22c55e;border:1px solid white;"></div>' : ""}
          </div>
          <div style="
            position:absolute;top:${size + 2}px;left:50%;transform:translateX(-50%);
            background:rgba(0,0,0,0.75);color:white;
            font-size:10px;font-family:Inter,sans-serif;font-weight:500;
            padding:1px 5px;border-radius:3px;white-space:nowrap;
          ">${member.memberName}${isMe ? " (you)" : ""}</div>
        `,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      if (markersRef.current.has(member.memberId)) {
        const existing = markersRef.current.get(member.memberId)!;
        existing.setLatLng([member.latitude, member.longitude]);
        existing.setIcon(icon);
      } else {
        const marker = L.marker([member.latitude, member.longitude], { icon }).addTo(map);
        markersRef.current.set(member.memberId, marker);
      }
    });

    // Remove stale markers
    for (const [id, marker] of markersRef.current.entries()) {
      if (!activeIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // Fit bounds on first load with data
    if (!initialFitRef.current && members.filter(m => m.isSharing).length > 0) {
      initialFitRef.current = true;
      const sharingMembers = members.filter(m => m.isSharing);
      if (sharingMembers.length === 1) {
        map.setView([sharingMembers[0].latitude, sharingMembers[0].longitude], 15);
      } else {
        const bounds = L.latLngBounds(sharingMembers.map(m => [m.latitude, m.longitude] as L.LatLngTuple));
        map.fitBounds(bounds, { padding: [60, 60] });
      }
    }
  }, [members, myMemberId]);

  // Update meeting point marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (meetingMarkerRef.current) {
      meetingMarkerRef.current.remove();
      meetingMarkerRef.current = null;
    }

    if (meetingPoint) {
      const icon = L.divIcon({
        className: "",
        html: `
          <div style="display:flex;flex-direction:column;align-items:center;">
            <div style="
              width:36px;height:36px;border-radius:50% 50% 50% 0;
              background:#f59e0b;
              border:3px solid white;
              box-shadow:0 2px 8px rgba(0,0,0,0.5);
              transform:rotate(-45deg);
              display:flex;align-items:center;justify-content:center;
            ">
              <div style="transform:rotate(45deg);font-size:14px;">&#x1F4CD;</div>
            </div>
            ${meetingPoint.label ? `<div style="margin-top:4px;background:rgba(245,158,11,0.9);color:white;font-size:10px;font-family:Inter,sans-serif;font-weight:600;padding:2px 6px;border-radius:3px;white-space:nowrap;">${meetingPoint.label}</div>` : ""}
          </div>
        `,
        iconSize: [36, 48],
        iconAnchor: [18, 48],
      });

      const marker = L.marker([meetingPoint.latitude, meetingPoint.longitude], { icon }).addTo(map);
      meetingMarkerRef.current = marker;
    }
  }, [meetingPoint]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      data-testid="map-container"
    />
  );
}
