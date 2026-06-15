import { useEffect, useRef, useCallback } from "react";
import { getSession } from "@/lib/session";

export type WsMessage =
  | { type: "connected"; payload: { memberId: string } }
  | { type: "location_update"; payload: any }
  | { type: "location_sharing_changed"; payload: { memberId: string; isSharing: boolean } }
  | { type: "message"; payload: any }
  | { type: "meeting_point"; payload: any | null }
  | { type: "sos"; payload: { memberName: string; latitude: number | null; longitude: number | null } }
  | { type: "member_joined"; payload: any }
  | { type: "member_left"; payload: any };

type MessageHandler = (msg: WsMessage) => void;

export function useWebSocket(groupId: string | undefined, onMessage: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(1000);
  const mountedRef = useRef(true);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!groupId) return;
    const session = getSession();
    if (!session) return;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/ws?groupId=${groupId}&token=${session.token}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      retryDelayRef.current = 1000;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        onMessageRef.current(msg);
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (!mountedRef.current) return;
      const delay = Math.min(retryDelayRef.current, 30000);
      retryDelayRef.current = delay * 2;
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [groupId]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);
}
