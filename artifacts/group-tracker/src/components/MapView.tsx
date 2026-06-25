import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getMemberColor, getDistanceMeters } from "@/lib/utils";

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
  latitude: number | null;
  longitude: number | null;
  isSharing: boolean;
  isSos?: boolean;
}

export interface MapMeetingPoint {
  latitude: number;
  longitude: number;
  label?: string | null;
}

/** Route drawn on the map from user's position to a destination. */
export interface ActiveRoute {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  label?: string | null;
}

interface MapViewProps {
  members: MapMember[];
  myMemberId: string;
  myPosition: { latitude: number; longitude: number } | null;
  meetingPoint: MapMeetingPoint | null;
  activeRoute?: ActiveRoute | null;
  onMapClick?: (lat: number, lng: number) => void;
  /** Called when the meeting-point marker is clicked. */
  onMeetingPointClick?: (lat: number, lng: number, label?: string | null) => void;
  /** Called when a route is successfully fetched with distance + duration info, or null on clear/error. */
  onRouteReady?: (info: { distanceM: number; durationS: number; coordinates?: { lat: number; lng: number }[]; isOfflineFallback?: boolean } | null) => void;
  settingMeetingPoint?: boolean;
  followUser?: boolean;
  onFollowUserChange?: (follow: boolean) => void;
}

export default function MapView({
  members,
  myMemberId,
  myPosition,
  meetingPoint,
  activeRoute,
  onMapClick,
  onMeetingPointClick,
  onRouteReady,
  settingMeetingPoint,
  followUser,
  onFollowUserChange,
}: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const meetingMarkerRef = useRef<L.Marker | null>(null);
  const routeLayersRef = useRef<L.Polyline[]>([]);
  const initialFitRef = useRef(false);

  // Stable refs for callbacks — prevents re-registering effects on every render
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onMeetingPointClickRef = useRef(onMeetingPointClick);
  onMeetingPointClickRef.current = onMeetingPointClick;
  const onRouteReadyRef = useRef(onRouteReady);
  onRouteReadyRef.current = onRouteReady;
  const onFollowUserChangeRef = useRef(onFollowUserChange);
  onFollowUserChangeRef.current = onFollowUserChange;

  // Listen to map drag to disable auto-follow
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handler = () => {
      onFollowUserChangeRef.current?.(false);
    };

    map.on("dragstart", handler);
    return () => {
      map.off("dragstart", handler);
    };
  }, []);

  // Auto-center map on user coordinates if Follow Me is active
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !followUser || !myPosition) return;
    map.setView([myPosition.latitude, myPosition.longitude], Math.max(map.getZoom(), 16));
  }, [myPosition, followUser]);

  // Listen to window resize and call map.invalidateSize() to handle mobile keyboard, rotations, or sidebar toggling
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleResize = () => {
      map.invalidateSize();
    };

    window.addEventListener("resize", handleResize);
    // Also run it after a short delay to account for animation/layout transition lag
    const timer = setTimeout(handleResize, 350);

    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timer);
    };
  }, [myPosition]);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const isMobile = window.innerWidth < 768;
    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 3,
      zoomControl: false,
    });

    if (!isMobile) {
      L.control.zoom({ position: "topright" }).addTo(map);
    }

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

  // Map click handler — fires for ALL clicks so GroupPage can collapse the sidebar
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handler = (e: L.LeafletMouseEvent) => {
      onMapClickRef.current?.(e.latlng.lat, e.latlng.lng);
    };

    map.on("click", handler);
    map.getContainer().style.cursor = settingMeetingPoint ? "crosshair" : "";

    return () => {
      map.off("click", handler);
      if (map.getContainer()) map.getContainer().style.cursor = "";
    };
  }, [settingMeetingPoint]);

  // Update member markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const activeIds = new Set<string>();

    members.forEach((member, idx) => {
      const hasValidCoords =
        member.isSharing &&
        member.latitude !== null &&
        member.latitude !== undefined &&
        member.longitude !== null &&
        member.longitude !== undefined &&
        isFinite(member.latitude) &&
        isFinite(member.longitude);

      if (!hasValidCoords) {
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
        className: "",
        html: `
          <div class="${member.isSos ? "sos-pulse" : ""}" style="
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
        existing.setLatLng([member.latitude as number, member.longitude as number]);
        existing.setIcon(icon);
      } else {
        const marker = L.marker([member.latitude as number, member.longitude as number], { icon }).addTo(map);
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
    const sharingMembers = members.filter(
      (m) =>
        m.isSharing &&
        m.latitude !== null &&
        m.latitude !== undefined &&
        m.longitude !== null &&
        m.longitude !== undefined &&
        isFinite(m.latitude) &&
        isFinite(m.longitude)
    ) as (MapMember & { latitude: number; longitude: number })[];

    if (!initialFitRef.current && sharingMembers.length > 0) {
      initialFitRef.current = true;
      if (sharingMembers.length === 1) {
        map.setView([sharingMembers[0].latitude, sharingMembers[0].longitude], 15);
      } else {
        // Build bounds by extending manually — avoids passing null tuples to L.latLngBounds
        const bounds = L.latLngBounds(
          [sharingMembers[0].latitude, sharingMembers[0].longitude],
          [sharingMembers[0].latitude, sharingMembers[0].longitude]
        );
        for (let i = 1; i < sharingMembers.length; i++) {
          bounds.extend([sharingMembers[i].latitude, sharingMembers[i].longitude]);
        }
        map.fitBounds(bounds, { padding: [60, 60] });
      }
    }
  }, [members, myMemberId]);

  // Draw / clear in-map route via OSRM public API
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Always clear any existing route layers first
    routeLayersRef.current.forEach((l) => l.remove());
    routeLayersRef.current = [];

    if (!activeRoute) {
      onRouteReadyRef.current?.(null);
      return;
    }

    const { fromLat, fromLng, toLat, toLng } = activeRoute;

    // OSRM public routing API (no API key required)
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${fromLng},${fromLat};${toLng},${toLat}` +
      `?overview=full&geometries=geojson`;

    let cancelled = false;

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const route = data?.routes?.[0];
        if (!route) { onRouteReadyRef.current?.(null); return; }

        const currentMap = mapRef.current;
        if (!currentMap || cancelled) return;

        const latLngs = (route.geometry.coordinates as [number, number][]).map(
          ([lng, lat]) => [lat, lng] as L.LatLngTuple
        );

        // Draw two layers: shadow (thick dark) + bright route line on top
        const shadow = L.polyline(latLngs, {
          color: "#0f172a",
          weight: 9,
          opacity: 0.45,
          lineJoin: "round",
          lineCap: "round",
        }).addTo(currentMap);

        const route_line = L.polyline(latLngs, {
          color: "#0ea5e9",
          weight: 5,
          opacity: 0.92,
          lineJoin: "round",
          lineCap: "round",
        }).addTo(currentMap);

        // Dashed animated overlay for a modern "active navigation" look
        const dashes = L.polyline(latLngs, {
          color: "#ffffff",
          weight: 2,
          opacity: 0.4,
          dashArray: "8 14",
          lineJoin: "round",
          lineCap: "round",
        }).addTo(currentMap);

        routeLayersRef.current = [shadow, route_line, dashes];

        // Fit map to show the whole route
        currentMap.fitBounds(route_line.getBounds(), { padding: [50, 50] });

        onRouteReadyRef.current?.({
          distanceM: route.distance,
          durationS: route.duration,
          coordinates: latLngs.map(([lat, lng]) => ({ lat, lng })),
        });
      })
      .catch(() => {
        if (cancelled) return;
        
        const currentMap = mapRef.current;
        if (!currentMap) return;

        // Fallback straight line route if offline/connection error
        const latLngs = [[fromLat, fromLng], [toLat, toLng]] as L.LatLngTuple[];

        const shadow = L.polyline(latLngs, {
          color: "#0f172a",
          weight: 9,
          opacity: 0.45,
          lineJoin: "round",
          lineCap: "round",
        }).addTo(currentMap);

        const route_line = L.polyline(latLngs, {
          color: "#64748b",
          weight: 5,
          opacity: 0.8,
          dashArray: "10 10",
          lineJoin: "round",
          lineCap: "round",
        }).addTo(currentMap);

        routeLayersRef.current = [shadow, route_line];
        currentMap.fitBounds(route_line.getBounds(), { padding: [50, 50] });

        const directDist = getDistanceMeters(fromLat, fromLng, toLat, toLng);
        onRouteReadyRef.current?.({
          distanceM: directDist,
          durationS: directDist / 1.4, // walking speed fallback
          coordinates: latLngs.map(([lat, lng]) => ({ lat, lng })),
          isOfflineFallback: true,
        });
      });

    return () => { cancelled = true; };
  }, [activeRoute]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (meetingMarkerRef.current) {
      meetingMarkerRef.current.remove();
      meetingMarkerRef.current = null;
    }

    if (
      meetingPoint &&
      meetingPoint.latitude !== null &&
      meetingPoint.longitude !== null &&
      meetingPoint.latitude !== undefined &&
      meetingPoint.longitude !== undefined &&
      isFinite(meetingPoint.latitude) &&
      isFinite(meetingPoint.longitude)
    ) {
      const icon = L.divIcon({
        className: "",
        html: `
          <div style="display:flex;flex-direction:column;align-items:center;cursor:pointer;">
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

      const lat = meetingPoint.latitude;
      const lng = meetingPoint.longitude;
      const label = meetingPoint.label || "Meeting Point";

      const marker = L.marker([lat, lng], { icon }).addTo(map);

      // On click fallback: notify parent — stop propagation so map click doesn't also fire
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onMeetingPointClickRef.current?.(lat, lng, meetingPoint.label);
      });

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
