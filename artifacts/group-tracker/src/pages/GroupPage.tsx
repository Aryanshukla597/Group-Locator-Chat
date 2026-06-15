import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetGroup, useGetGroupMembers, useGetGroupLocations,
  useGetMeetingPoint, useListMessages, useUpdateLocation, useTriggerSos,
  useSetMeetingPoint,
  getGetGroupMembersQueryKey, getGetGroupLocationsQueryKey,
  getGetMeetingPointQueryKey, getListMessagesQueryKey,
} from "@workspace/api-client-react";
import { getSession, clearSession } from "@/lib/session";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";
import { useGeolocation } from "@/hooks/useGeolocation";
import MapView, { type MapMember, type MapMeetingPoint } from "@/components/MapView";
import Sidebar from "@/components/Sidebar";
import { AlertTriangle, X, MapPin, Loader2 } from "lucide-react";

interface SosAlert {
  memberName: string;
  latitude: number | null;
  longitude: number | null;
}

export default function GroupPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const session = getSession();

  const [isSharing, setIsSharing] = useState(true);
  const [settingMeetingPoint, setSettingMeetingPoint] = useState(false);
  const [sosAlert, setSosAlert] = useState<SosAlert | null>(null);
  const [myPosition, setMyPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [showSosConfirm, setShowSosConfirm] = useState(false);
  const sosTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Redirect if no session or wrong group
  useEffect(() => {
    if (!session || session.groupId !== groupId) {
      clearSession();
      setLocation("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const { data: group } = useGetGroup(groupId);
  const { data: members = [] } = useGetGroupMembers(groupId);
  const { data: locations = [], isLoading: locsLoading } = useGetGroupLocations(groupId);
  const { data: meetingPoint = null } = useGetMeetingPoint(groupId);
  const { data: messages = [] } = useListMessages(groupId);
  const updateLocation = useUpdateLocation();
  const triggerSos = useTriggerSos();
  const setMeetingPointMutation = useSetMeetingPoint();

  // Live location
  const handleGeoUpdate = useCallback((pos: { latitude: number; longitude: number; accuracy: number }) => {
    setMyPosition(pos);
    if (!isSharing) return;
    updateLocation.mutate(
      { groupId, data: { latitude: pos.latitude, longitude: pos.longitude, accuracy: pos.accuracy } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetGroupLocationsQueryKey(groupId) }) }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, isSharing]);

  useGeolocation(true, handleGeoUpdate);

  // Poll location every 15s to keep it fresh
  useEffect(() => {
    const interval = setInterval(() => {
      if (myPosition && isSharing) {
        updateLocation.mutate({ groupId, data: { latitude: myPosition.latitude, longitude: myPosition.longitude } });
      }
    }, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, isSharing, myPosition]);

  // WebSocket handler
  const handleWsMessage = useCallback((msg: WsMessage) => {
    switch (msg.type) {
      case "location_update":
        queryClient.invalidateQueries({ queryKey: getGetGroupLocationsQueryKey(groupId) });
        break;
      case "location_sharing_changed":
        queryClient.invalidateQueries({ queryKey: getGetGroupLocationsQueryKey(groupId) });
        queryClient.invalidateQueries({ queryKey: getGetGroupMembersQueryKey(groupId) });
        break;
      case "message":
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(groupId) });
        break;
      case "meeting_point":
        queryClient.invalidateQueries({ queryKey: getGetMeetingPointQueryKey(groupId) });
        break;
      case "sos": {
        const alert: SosAlert = { ...msg.payload };
        setSosAlert(alert);
        if (sosTimerRef.current) clearTimeout(sosTimerRef.current);
        sosTimerRef.current = setTimeout(() => setSosAlert(null), 10000);
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(groupId) });
        break;
      }
      case "member_joined":
      case "member_left":
        queryClient.invalidateQueries({ queryKey: getGetGroupMembersQueryKey(groupId) });
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(groupId) });
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, queryClient]);

  useWebSocket(groupId, handleWsMessage);

  const handleSosConfirm = () => {
    setShowSosConfirm(false);
    triggerSos.mutate({ groupId });
  };

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (!settingMeetingPoint) return;
    setSettingMeetingPoint(false);
    setMeetingPointMutation.mutate(
      { groupId, data: { latitude: lat, longitude: lng } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetMeetingPointQueryKey(groupId) }) }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, settingMeetingPoint]);

  // Build map members
  const mapMembers: MapMember[] = locations.map((loc) => ({
    memberId: loc.memberId,
    memberName: loc.memberName,
    latitude: loc.latitude,
    longitude: loc.longitude,
    isSharing: loc.isSharing,
    isSos: sosAlert?.memberName === loc.memberName,
  }));

  const mapMeetingPoint: MapMeetingPoint | null = meetingPoint
    ? { latitude: meetingPoint.latitude, longitude: meetingPoint.longitude, label: meetingPoint.label }
    : null;

  if (!session) return null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <Sidebar
        session={session}
        members={members}
        locations={locations.map(l => ({ ...l, accuracy: l.accuracy ?? null }))}
        messages={messages.map(m => ({ ...m, memberId: m.memberId ?? null }))}
        meetingPoint={meetingPoint ?? null}
        myPosition={myPosition}
        isSharing={isSharing}
        onSharingChange={setIsSharing}
        onSetMeetingPoint={() => setSettingMeetingPoint(true)}
        onLeave={() => { clearSession(); setLocation("/"); }}
      />

      {/* Main map area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Map */}
        <div className="absolute inset-0">
          <MapView
            members={mapMembers}
            myMemberId={session.memberId}
            meetingPoint={mapMeetingPoint}
            onMapClick={handleMapClick}
            settingMeetingPoint={settingMeetingPoint}
          />
        </div>

        {/* Group name header */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] pointer-events-none">
          <div className="bg-background/80 backdrop-blur-sm border border-border rounded-lg px-4 py-2 shadow-lg">
            <p className="text-xs font-semibold text-foreground">{group?.name ?? "Loading..."}</p>
          </div>
        </div>

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

        {/* SOS Alert banner */}
        {sosAlert && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[600] w-full max-w-sm px-4">
            <div className="bg-red-600 text-white rounded-xl shadow-2xl p-4 border-2 border-red-400 sos-pulse">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <div>
                    <p className="font-bold text-sm">SOS ALERT</p>
                    <p className="text-sm">{sosAlert.memberName} needs help!</p>
                    {sosAlert.latitude !== null && (
                      <p className="text-xs mt-1 text-red-200">
                        {sosAlert.latitude?.toFixed(5)}, {sosAlert.longitude?.toFixed(5)}
                      </p>
                    )}
                  </div>
                </div>
                <button onClick={() => setSosAlert(null)} className="shrink-0 mt-0.5">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SOS Confirm Dialog */}
      {showSosConfirm && (
        <div className="fixed inset-0 bg-black/60 z-[700] flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-foreground">Send SOS Alert?</h3>
                <p className="text-xs text-muted-foreground">All group members will be notified immediately</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSosConfirm(false)}
                className="flex-1 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:bg-accent transition-colors"
                data-testid="button-sos-cancel"
              >
                Cancel
              </button>
              <button
                onClick={handleSosConfirm}
                className="flex-1 py-2 rounded-lg text-sm bg-red-600 text-white font-semibold hover:bg-red-500 transition-colors"
                data-testid="button-sos-confirm"
              >
                Send SOS
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
