import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

export function getMemberColor(index: number): string {
  const colors = [
    "#0ea5e9", "#22c55e", "#f59e0b", "#a855f7",
    "#ec4899", "#14b8a6", "#f97316", "#06b6d4",
  ];
  return colors[index % colors.length];
}

export function getInviteUrl(inviteCode: string): string {
  const base = window.location.origin + window.location.pathname.replace(/\/$/, "");
  return `${base}?join=${inviteCode}`;
}

export function getDistanceToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    return getDistanceMeters(px, py, ax, ay);
  }
  
  // Calculate projection parameter t, clamped to [0, 1]
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  
  const closestLat = ax + t * dx;
  const closestLng = ay + t * dy;
  return getDistanceMeters(px, py, closestLat, closestLng);
}

export function getDistanceToPolyline(
  lat: number, lng: number,
  points: { lat: number; lng: number }[]
): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return getDistanceMeters(lat, lng, points[0].lat, points[0].lng);
  
  let minDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = getDistanceToSegment(
      lat, lng,
      points[i].lat, points[i].lng,
      points[i+1].lat, points[i+1].lng
    );
    if (d < minDist) minDist = d;
  }
  return minDist;
}
