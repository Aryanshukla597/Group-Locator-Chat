import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetGroup, useGetGroupMembers, useGetGroupLocations,
  useGetMeetingPoint, useListMessages, useUpdateLocation, useTriggerSos,
  useSetMeetingPoint, useUpdateLocationSharing, useUpdateMemberActive,
  getGetGroupMembersQueryKey, getGetGroupLocationsQueryKey,
  getGetMeetingPointQueryKey, getListMessagesQueryKey, getGetGroupQueryKey,
} from "@workspace/api-client-react";
import { getSession, clearSession } from "@/lib/session";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useToast } from "@/hooks/use-toast";
import MapView, { type MapMember, type MapMeetingPoint, type ActiveRoute } from "@/components/MapView";
import Sidebar from "@/components/Sidebar";
import { AlertTriangle, X, MapPin, Loader2, Navigation, Clock, Compass, WifiOff, Menu } from "lucide-react";
import { getDistanceMeters, formatDistance, formatDuration, getDistanceToPolyline, cn } from "@/lib/utils";

interface SosAlert {
  id: string;
  memberName: string;
  latitude: number | null;
  longitude: number | null;
  category?: string;
  type?: string;
}

function SosAlertBanner({ alert, onDismiss }: { alert: SosAlert; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 15000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  let bgClass = "bg-red-600 border-red-400";
  let iconLabel = "🚨";
  let title = "SOS ALERT";

  if (alert.category === "medical") {
    bgClass = "bg-pink-600 border-pink-400";
    iconLabel = "🏥";
    title = "MEDICAL EMERGENCY";
  } else if (alert.category === "fire") {
    bgClass = "bg-amber-600 border-amber-400";
    iconLabel = "🔥";
    title = "FIRE EMERGENCY";
  } else if (alert.category === "police") {
    bgClass = "bg-blue-600 border-blue-400";
    iconLabel = "🚓";
    title = "POLICE EMERGENCY";
  }

  return (
    <div className={`text-white rounded-xl shadow-2xl p-4 border-2 sos-pulse pointer-events-auto flex items-start justify-between gap-3 ${bgClass}`}>
      <div className="flex items-center gap-2">
        <span className="text-xl shrink-0">{iconLabel}</span>
        <div>
          <p className="font-bold text-[10px] tracking-wide opacity-90">{title}</p>
          <p className="text-sm font-semibold">{alert.memberName} needs help!</p>
          {alert.latitude !== null && (
            <p className="text-[10px] mt-0.5 text-white/80">
              {alert.latitude?.toFixed(5)}, {alert.longitude?.toFixed(5)}
            </p>
          )}
        </div>
      </div>
      <button onClick={onDismiss} className="shrink-0 mt-0.5 opacity-80 hover:opacity-100">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function GroupPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const session = getSession();

  const [isSharing, setIsSharing] = useState(true);
  const [settingMeetingPoint, setSettingMeetingPoint] = useState(false);
  const [sosAlerts, setSosAlerts] = useState<SosAlert[]>([]);
  const [myPosition, setMyPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [showSosConfirm, setShowSosConfirm] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeRoute, setActiveRoute] = useState<ActiveRoute | null>(null);
  const [selectedMeetingPoint, setSelectedMeetingPoint] = useState<{ lat: number; lng: number; label: string | null } | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ distanceM: number; durationS: number } | null>(null);
  const [routeFetching, setRouteFetching] = useState(false);
  const [followUser, setFollowUser] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const routeCoordinatesRef = useRef<{ lat: number; lng: number }[]>([]);
  const lastLocalUpdateRef = useRef<{ latitude: number; longitude: number; timestamp: number } | null>(null);
  const lastServerUpdateRef = useRef<{ latitude: number; longitude: number; timestamp: number } | null>(null);
  const myPositionRef = useRef(myPosition);
  myPositionRef.current = myPosition;
  const isSharingRef = useRef(isSharing);
  isSharingRef.current = isSharing;

  // Track network online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const { toast } = useToast();

  const { data: group } = useGetGroup(groupId);
  const { data: members = [] } = useGetGroupMembers(groupId);
  const { data: locations = [], isLoading: locsLoading } = useGetGroupLocations(groupId);
  const { data: meetingPoint = null } = useGetMeetingPoint(groupId);

  // Redirect if no session or wrong group
  useEffect(() => {
    if (!session || session.groupId !== groupId) {
      clearSession();
      setLocation("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Redirect if group is marked ended/inactive
  useEffect(() => {
    if (group && group.isActive === false) {
      alert("This group sharing session has ended.");
      clearSession();
      setLocation("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);
  const { data: messages = [] } = useListMessages(groupId);
  const updateLocation = useUpdateLocation();
  const triggerSos = useTriggerSos();
  const setMeetingPointMutation = useSetMeetingPoint();
  const updateActiveStatus = useUpdateMemberActive();

  // Live location (with double-throttled updates to protect mobile performance)
  const handleGeoUpdate = useCallback((pos: { latitude: number; longitude: number; accuracy: number }) => {
    const now = Date.now();
    const lastLocalUpdate = lastLocalUpdateRef.current;
    const lastServerUpdate = lastServerUpdateRef.current;

    // 1. Throttle local map re-renders (state updates) to 3s or 2m
    const shouldUpdateLocal =
      !lastLocalUpdate ||
      now - lastLocalUpdate.timestamp >= 3000 ||
      getDistanceMeters(lastLocalUpdate.latitude, lastLocalUpdate.longitude, pos.latitude, pos.longitude) > 2;

    if (shouldUpdateLocal) {
      setMyPosition(pos);
      lastLocalUpdateRef.current = { latitude: pos.latitude, longitude: pos.longitude, timestamp: now };
    }

    if (!isSharing) return;

    // 2. Throttle backend db requests to 10s or 5m
    const shouldUpdateServer =
      !lastServerUpdate ||
      now - lastServerUpdate.timestamp >= 10000 ||
      getDistanceMeters(lastServerUpdate.latitude, lastServerUpdate.longitude, pos.latitude, pos.longitude) > 5;

    if (shouldUpdateServer) {
      lastServerUpdateRef.current = { latitude: pos.latitude, longitude: pos.longitude, timestamp: now };
      // NOTE: No invalidateQueries here — the WebSocket `location_update` event
      // already patches the React Query cache in-memory (see handleWsMessage).
      updateLocation.mutate({ groupId, data: { latitude: pos.latitude, longitude: pos.longitude, accuracy: pos.accuracy } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, isSharing]);

  useGeolocation(true, handleGeoUpdate);

  const dismissAlert = useCallback((id: string) => {
    setSosAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  // Auto-sync when network is back online
  useEffect(() => {
    const handleOnline = () => {
      const currentPos = myPositionRef.current;
      const currentSharing = isSharingRef.current;
      if (currentPos && currentSharing) {
        updateLocation.mutate({
          groupId,
          data: { latitude: currentPos.latitude, longitude: currentPos.longitude }
        });
      }
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [groupId]);

  // Keepalive: send a heartbeat every 2 minutes IF user is sharing AND has moved > 5m since last keepalive.
  // This keeps the server timestamp fresh while drastically reducing DB writes for stationary users.
  const keepalivePosRef = useRef<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => {
    const interval = setInterval(() => {
      const currentPos = myPositionRef.current;
      const currentSharing = isSharingRef.current;
      if (!currentPos || !currentSharing) return;

      const lastKeepalive = keepalivePosRef.current;
      const hasMoved = !lastKeepalive ||
        getDistanceMeters(lastKeepalive.latitude, lastKeepalive.longitude, currentPos.latitude, currentPos.longitude) > 5;

      if (hasMoved) {
        keepalivePosRef.current = { latitude: currentPos.latitude, longitude: currentPos.longitude };
        updateLocation.mutate({ groupId, data: { latitude: currentPos.latitude, longitude: currentPos.longitude } });
      }
    }, 120000); // 2 minutes — sufficient given 5-minute Online threshold
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Mark offline/online on visibility changes or page close to maintain status accuracy
  useEffect(() => {
    const markOffline = () => {
      const s = getSession();
      if (!s) return;
      fetch(`/api/groups/${groupId}/members/me/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${s.token}`,
        },
        body: JSON.stringify({ isOnline: false }),
        keepalive: true,
      }).catch(() => {});
    };

    const markOnline = () => {
      const s = getSession();
      if (!s) return;
      fetch(`/api/groups/${groupId}/members/me/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${s.token}`,
        },
        body: JSON.stringify({ isOnline: true }),
      }).catch(() => {});
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markOffline();
      } else if (document.visibilityState === "visible") {
        markOnline();
      }
    };

    window.addEventListener("beforeunload", markOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", markOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Active screen detection logic (window.onfocus / window.onblur)
  useEffect(() => {
    if (!groupId) return;

    const handleFocus = () => {
      updateActiveStatus.mutate({ groupId, data: { isActive: true } });
    };

    const handleBlur = () => {
      updateActiveStatus.mutate({ groupId, data: { isActive: false } });
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    // Initial state on mount
    if (document.hasFocus()) {
      handleFocus();
    } else {
      handleBlur();
    }

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // WebSocket handler
  const handleWsMessage = useCallback((msg: WsMessage) => {
    if (!groupId) return;

    switch (msg.type) {
      case "location_update": {
        const updatedLoc = msg.payload;
        queryClient.setQueryData(getGetGroupLocationsQueryKey(groupId), (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          const exists = prev.some((l: any) => l.memberId === updatedLoc.memberId);
          if (exists) {
            return prev.map((l: any) => l.memberId === updatedLoc.memberId ? { ...l, ...updatedLoc } : l);
          } else {
            return [...prev, updatedLoc];
          }
        });
        break;
      }
      case "location_sharing_changed": {
        const payload = msg.payload;
        queryClient.setQueryData(getGetGroupLocationsQueryKey(groupId), (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((l: any) => l.memberId === payload.memberId ? {
            ...l,
            isSharing: payload.isSharing !== undefined ? payload.isSharing : l.isSharing,
            isOnline: payload.isOnline !== undefined ? payload.isOnline : l.isOnline
          } : l);
        });
        queryClient.setQueryData(getGetGroupMembersQueryKey(groupId), (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((m: any) => m.id === payload.memberId ? {
            ...m,
            isLocationSharing: payload.isSharing !== undefined ? payload.isSharing : m.isLocationSharing,
            isOnline: payload.isOnline !== undefined ? payload.isOnline : m.isOnline,
            isActive: payload.isOnline !== undefined ? (payload.isOnline ? m.isActive : false) : m.isActive
          } : m);
        });
        break;
      }
      case "message": {
        const newMessage = msg.payload;
        queryClient.setQueryData(getListMessagesQueryKey(groupId), (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          if (prev.some((m: any) => m.id === newMessage.id)) return prev;
          return [...prev, newMessage];
        });
        // Also update sender online status in locations list cache
        if (newMessage.memberId) {
          queryClient.setQueryData(getGetGroupLocationsQueryKey(groupId), (prev: any) => {
            if (!Array.isArray(prev)) return prev;
            return prev.map((l: any) => l.memberId === newMessage.memberId ? { ...l, isOnline: true } : l);
          });
        }
        break;
      }
      case "meeting_point":
        queryClient.setQueryData(getGetMeetingPointQueryKey(groupId), msg.payload);
        break;
      case "sos": {
        const payload = msg.payload as any;
        const alertId = Math.random().toString(36).substring(2, 9);
        const alert: SosAlert = {
          id: alertId,
          memberName: payload.memberName,
          latitude: payload.latitude,
          longitude: payload.longitude,
          category: payload.category || "general",
          type: payload.type || "sos"
        };
        if (navigator.vibrate) {
          navigator.vibrate([200, 100, 200, 100, 200]);
        }
        setSosAlerts(prev => [...prev, alert]);
        break;
      }
      case "member_joined": {
        const payload = msg.payload;
        queryClient.setQueryData(getGetGroupMembersQueryKey(groupId), (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          if (prev.some((m: any) => m.id === payload.id)) return prev;
          return [...prev, { id: payload.id, name: payload.name, role: "member", isLocationSharing: payload.isLocationSharing, isOnline: true, isActive: true, joinedAt: payload.joinedAt }];
        });
        queryClient.setQueryData(getGetGroupLocationsQueryKey(groupId), (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          if (prev.some((l: any) => l.memberId === payload.id)) return prev;
          return [...prev, { memberId: payload.id, memberName: payload.name, latitude: null, longitude: null, accuracy: null, updatedAt: null, isSharing: payload.isLocationSharing, isOnline: true }];
        });
        break;
      }
      case "member_left": {
        const payload = msg.payload;
        if (session && payload.id === session.memberId) {
          clearSession();
          setLocation("/");
          
          if (payload.action === "kick") {
            toast({
              title: "Removed from Group",
              description: "You have been removed from the group by the Creator.",
              variant: "destructive"
            });
          } else {
            toast({
              title: "Left Group",
              description: "You left the group.",
            });
          }
          break;
        }
        queryClient.setQueryData(getGetGroupMembersQueryKey(groupId), (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          return prev.filter((m: any) => m.id !== payload.id);
        });
        queryClient.setQueryData(getGetGroupLocationsQueryKey(groupId), (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          return prev.filter((l: any) => l.memberId !== payload.id);
        });
        break;
      }
      case "member_role_changed": {
        const payload = msg.payload;
        queryClient.setQueryData(getGetGroupMembersQueryKey(groupId), (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((m: any) => m.id === payload.memberId ? { ...m, role: payload.role } : m);
        });
        break;
      }
      case "read_receipt": {
        const payload = msg.payload;
        queryClient.setQueryData(getGetGroupMembersQueryKey(groupId), (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((m: any) => m.id === payload.memberId ? { ...m, lastReadMessageId: payload.messageId } : m);
        });
        break;
      }
      case "member_active_changed": {
        const payload = msg.payload;
        queryClient.setQueryData(getGetGroupMembersQueryKey(groupId), (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((m: any) => m.id === payload.memberId ? { ...m, isActive: payload.isActive } : m);
        });
        break;
      }
      case "group_lock_changed": {
        const payload = msg.payload;
        queryClient.setQueryData(getGetGroupQueryKey(groupId), (prev: any) => {
          if (!prev) return prev;
          return { ...prev, isLocked: payload.isLocked };
        });
        break;
      }
      case "group_ended":
        alert("The group sharing session has been ended by the creator.");
        clearSession();
        setLocation("/");
        break;
      case "message_updated": {
        const updatedMsg = msg.payload;
        queryClient.setQueryData(getListMessagesQueryKey(groupId), (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((m: any) => m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m);
        });
        break;
      }
      case "message_deleted": {
        const payload = msg.payload;
        queryClient.setQueryData(getListMessagesQueryKey(groupId), (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          return prev.filter((m: any) => m.id !== payload.messageId);
        });
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, queryClient]);

  useWebSocket(groupId, handleWsMessage);

  // Recalculate route if user deviates > 40m from active path
  useEffect(() => {
    if (!activeRoute || !myPosition) return;

    let shouldRecalculate = false;

    // Check deviation if route coordinates are loaded
    if (routeCoordinatesRef.current.length > 1) {
      const deviation = getDistanceToPolyline(
        myPosition.latitude,
        myPosition.longitude,
        routeCoordinatesRef.current
      );
      if (deviation > 40) {
        shouldRecalculate = true;
        toast({
          title: "Recalculating Route",
          description: "Detecting route deviation. Calculating new path...",
        });
      }
    }

    if (shouldRecalculate) {
      setActiveRoute(prev => prev ? {
        ...prev,
        fromLat: myPosition.latitude,
        fromLng: myPosition.longitude,
      } : null);
    }
  }, [myPosition, activeRoute]);

  // Clear route, route info, and selected states when the group's meeting point changes
  useEffect(() => {
    setActiveRoute(null);
    setRouteInfo(null);
    setRouteFetching(false);
    setSelectedMeetingPoint(null);
  }, [meetingPoint?.latitude, meetingPoint?.longitude]);


  const handleMapClick = useCallback((lat: number, lng: number) => {
    // Always collapse sidebar for better map visibility
    setSidebarCollapsed(true);
    setSelectedMeetingPoint(null); // Dismiss meeting point sheet on map click

    if (settingMeetingPoint) {
      setSettingMeetingPoint(false);
      setMeetingPointMutation.mutate(
        { groupId, data: { latitude: lat, longitude: lng } },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetMeetingPointQueryKey(groupId) }) }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, settingMeetingPoint]);

  /** Show the directions bottom sheet when the meeting point is clicked. */
  const handleMeetingPointClick = useCallback((
    lat: number,
    lng: number,
    label?: string | null
  ) => {
    setSidebarCollapsed(true);
    
    // Clear any previous active route and directions when a new meeting point selection starts
    setActiveRoute(null);
    setRouteInfo(null);
    setRouteFetching(false);

    setSelectedMeetingPoint({
      lat,
      lng,
      label: label || "Meeting Point",
    });
  }, []);

  /** Receives route metadata from MapView once the OSRM fetch completes. */
  const handleRouteReady = useCallback((info: { distanceM: number; durationS: number; coordinates?: { lat: number; lng: number }[]; isOfflineFallback?: boolean } | null) => {
    setRouteFetching(false);
    setRouteInfo(info);
    routeCoordinatesRef.current = info?.coordinates || [];
    
    if (info?.isOfflineFallback) {
      toast({
        title: "Offline Routing Fallback",
        description: "Internet connection unavailable. Showing straight line route to meeting point.",
      });
    } else if (info === null && activeRoute) {
      // OSRM returned no route — show feedback
      toast({
        title: "Route Unavailable",
        description: "Could not calculate a route. Check your connection and try again.",
        variant: "destructive",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoute, toast]);

  const handleClearRoute = useCallback(() => {
    setActiveRoute(null);
    setRouteInfo(null);
    setRouteFetching(false);
  }, []);

  if (!session) return null;

  const activeSosAlerts = sosAlerts.slice(0, 3);
  const activeSosMemberNames = new Set(activeSosAlerts.map(a => a.memberName));

  // Memoize mapMembers — only recompute when locations, myPosition, or SOS state actually changes.
  // This prevents MapView from re-rendering on unrelated sidebar/chat state updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mapMembers: MapMember[] = useMemo(() => {
    return locations.map((loc) => {
      const isMe = loc.memberId === session.memberId;
      const isSos = activeSosMemberNames.has(loc.memberName);
      const activeSos = activeSosAlerts.find(a => a.memberName === loc.memberName);
      const category = activeSos?.category || "general";

      // Determine if user's location is fallback / stale (older than 5 minutes or missing live GPS)
      const isLocationStale = loc.updatedAt ? (Date.now() - new Date(loc.updatedAt).getTime() > 300000) : true;
      const isFallback = isMe ? !myPosition : (isLocationStale || !loc.isSharing);

      return {
        memberId: loc.memberId,
        memberName: loc.memberName,
        latitude: (isMe && myPosition) ? myPosition.latitude : loc.latitude,
        longitude: (isMe && myPosition) ? myPosition.longitude : loc.longitude,
        isSharing: loc.isSharing,
        isSos,
        sosCategory: category,
        isOnline: isMe ? true : loc.isOnline,
        isFallback: !!isFallback
      };
    });
  // activeSosMemberNames is re-created each render from activeSosAlerts, so use the array as dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, myPosition, activeSosAlerts, session.memberId]);

  const mapMeetingPoint: MapMeetingPoint | null = useMemo(() =>
    meetingPoint
      ? { latitude: meetingPoint.latitude, longitude: meetingPoint.longitude, label: meetingPoint.label }
      : null
  , [meetingPoint]);

  // Derived admin/lock state from group data
  const groupData = group as (typeof group & { isLocked?: boolean; adminId?: string }) | undefined;
  const isLocked = groupData?.isLocked ?? false;
  const isAdmin = !!groupData?.adminId && groupData.adminId === session?.memberId;

  return (
    <div className="flex h-[100dvh] w-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <Sidebar
        session={session}
        members={members}
        locations={locations.map(l => ({ ...l, accuracy: l.accuracy ?? null }))}
        messages={messages.map(m => ({ ...m, memberId: m.memberId ?? null }))}
        meetingPoint={meetingPoint ?? null}
        myPosition={myPosition}
        isSharing={isSharing}
        isAdmin={isAdmin}
        isLocked={isLocked}
        onSharingChange={setIsSharing}
        onSetMeetingPoint={() => setSettingMeetingPoint(true)}
        onLeave={() => { clearSession(); setLocation("/"); }}
        collapsed={sidebarCollapsed}
        onCollapseChange={setSidebarCollapsed}
      />

      {/* Main map area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Map */}
        <div className="absolute inset-0">
          <MapView
            members={mapMembers}
            myMemberId={session.memberId}
            myPosition={myPosition}
            meetingPoint={mapMeetingPoint}
            activeRoute={activeRoute}
            onMapClick={handleMapClick}
            onMeetingPointClick={handleMeetingPointClick}
            onRouteReady={handleRouteReady}
            settingMeetingPoint={settingMeetingPoint}
            followUser={followUser}
            onFollowUserChange={setFollowUser}
          />
        </div>

        {/* Follow Me Toggle Button */}
        <div className="absolute bottom-6 left-6 z-[500]">
          <button
            onClick={() => {
              setFollowUser(prev => !prev);
              // Force centering on toggle ON
              if (!followUser && myPosition) {
                // Centering is handled automatically by followUser watcher in MapView
              }
            }}
            className={cn(
              "w-12 h-12 rounded-full border backdrop-blur-xl flex items-center justify-center transition-all active:scale-95 shadow-xl cursor-pointer",
              followUser 
                ? "bg-primary border-primary text-primary-foreground shadow-primary/20 shadow-glow-primary animate-pulse" 
                : "bg-slate-950/80 border-white/10 text-slate-300 hover:text-white"
            )}
            title={followUser ? "Stop following location" : "Follow my location"}
          >
            <Compass className="w-5.5 h-5.5" />
          </button>
        </div>

        {/* Offline Warning Banner */}
        {!isOnline && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[500] animate-in fade-in duration-300">
            <div className="bg-red-950/95 border border-red-500/30 text-red-200 px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold backdrop-blur-xl">
              <WifiOff className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <span>Offline Mode — Viewing Cached Map Data Only</span>
            </div>
          </div>
        )}
        {/* Floating Menu Button for mobile/responsive sidebar */}
        {sidebarCollapsed && (
          <div className="absolute top-4 left-4 z-[500] md:hidden">
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="w-11 h-11 rounded-xl bg-slate-950/85 border border-white/10 backdrop-blur-xl flex items-center justify-center text-slate-300 hover:text-white transition-all active:scale-95 shadow-xl cursor-pointer"
              title="Show Sidebar"
            >
              <Menu className="w-5.5 h-5.5" />
            </button>
          </div>
        )}
        {/* Bottom Sheet for Meeting Point Details & Directions */}
        {selectedMeetingPoint && (
          <div className="absolute bottom-24 right-4 z-[500] animate-in slide-in-from-bottom-3 fade-in duration-300">
            <div className="bg-slate-950/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-4 min-w-[210px] max-w-[280px]">
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500 font-bold shrink-0">
                    📍
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs font-bold text-white truncate max-w-[150px]">
                      {selectedMeetingPoint.label || "Meeting Point"}
                    </h3>
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5 leading-none">
                      {selectedMeetingPoint.lat.toFixed(5)}, {selectedMeetingPoint.lng.toFixed(5)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedMeetingPoint(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
                  title="Close directions sheet"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Action Button */}
              <button
                onClick={() => {
                  const lat = selectedMeetingPoint.lat;
                  const lng = selectedMeetingPoint.lng;
                  const label = selectedMeetingPoint.label;
                  setSelectedMeetingPoint(null); // Close sheet
                  
                  // Trigger directions
                  const pos = myPositionRef.current;
                  if (!pos) {
                    toast({
                      title: "Location Not Available",
                      description: "Enable location sharing to get directions on the map.",
                      variant: "destructive",
                    });
                    return;
                  }
                  setRouteInfo(null);
                  setRouteFetching(true);
                  setActiveRoute({
                    fromLat: pos.latitude,
                    fromLng: pos.longitude,
                    toLat: lat,
                    toLng: lng,
                    label,
                  });
                }}
                className="w-full py-2.5 px-3 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl font-bold text-xs transition-all hover:scale-[1.01] active:scale-95 flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/10 cursor-pointer"
              >
                <Navigation className="w-3.5 h-3.5 fill-current rotate-45" />
                Show Directions
              </button>
            </div>
          </div>
        )}

        {/* Route Info Panel — shown when a route is active */}
        {(activeRoute || routeFetching) && (
          <div className="absolute bottom-24 right-4 z-[500] animate-in slide-in-from-bottom-3 fade-in duration-300">
            <div className="bg-slate-950/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-4 min-w-[210px]">
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-primary shadow-glow-primary" />
                  <span className="text-xs font-bold text-white truncate max-w-[130px]">
                    {activeRoute?.label || "Meeting Point"}
                  </span>
                </div>
                <button
                  onClick={handleClearRoute}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                  title="Clear route"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Route metrics or loading state */}
              {routeInfo ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5 p-2 bg-white/5 rounded-xl">
                    <Navigation className="w-3.5 h-3.5 text-primary shrink-0" />
                    <div>
                      <p className="text-[10px] text-slate-400 leading-none mb-0.5">Distance</p>
                      <p className="text-sm font-bold text-white">{formatDistance(routeInfo.distanceM)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 p-2 bg-white/5 rounded-xl">
                    <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <div>
                      <p className="text-[10px] text-slate-400 leading-none mb-0.5">Est. Drive Time</p>
                      <p className="text-sm font-bold text-white">{formatDuration(routeInfo.durationS)}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 py-1 text-slate-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  <span className="text-xs">Calculating route...</span>
                </div>
              )}
            </div>
          </div>
        )}


        {/* SOS button */}
        <div className="absolute bottom-6 right-6 z-[500]">
          <button
            data-testid="button-sos"
            onClick={() => setShowSosConfirm(true)}
            className="w-16 h-16 rounded-full bg-red-600 text-white shadow-xl border-4 border-red-400 hover:bg-red-500 active:scale-95 transition-all flex items-center justify-center font-bold text-sm"
          >
            SOS
          </button>
        </div>

        {/* Setting meeting point hint */}
        {settingMeetingPoint && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[500]">
            <div className="bg-amber-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium">
              <MapPin className="w-4 h-4" />
              Click on the map to set meeting point
              <button onClick={() => setSettingMeetingPoint(false)} className="ml-2">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {locsLoading && (
          <div className="absolute top-3 right-3 z-[500]">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          </div>
        )}

        {/* SOS Alert banners (max 3 at a time) */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1100] w-full max-w-sm px-4 flex flex-col gap-2 pointer-events-none">
          {activeSosAlerts.map((alert) => (
            <SosAlertBanner
              key={alert.id}
              alert={alert}
              onDismiss={() => dismissAlert(alert.id)}
            />
          ))}
        </div>
      </div>

      {/* SOS Confirm Dialog */}
      {showSosConfirm && (
        <div className="fixed inset-0 bg-black/60 z-[1200] flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-foreground">Send SOS Alert?</h3>
                <p className="text-xs text-muted-foreground">Select emergency category to notify members</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                { id: "general", label: "General SOS", icon: "⚠️", color: "border-red-500 bg-red-500/10 text-red-400 hover:bg-red-500/20" },
                { id: "medical", label: "Medical Aid", icon: "🏥", color: "border-pink-500 bg-pink-500/10 text-pink-400 hover:bg-pink-500/20" },
                { id: "fire", label: "Fire Alert", icon: "🔥", color: "border-amber-500 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" },
                { id: "police", label: "Police Alert", icon: "🚓", color: "border-blue-500 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20" }
              ].map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setShowSosConfirm(false);
                    triggerSos.mutate(
                      { groupId, data: { category: cat.id as any } }
                    );
                  }}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-semibold transition-all hover:scale-[1.02] active:scale-95 ${cat.color}`}
                >
                  <span className="text-2xl">{cat.icon}</span>
                  {cat.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowSosConfirm(false)}
              className="w-full py-2 rounded-lg text-sm border border-border text-muted-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
