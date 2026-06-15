import { useState, useRef, useEffect } from "react";
import { useLeaveGroup, useUpdateLocationSharing, useSendMessage, useClearMeetingPoint } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetGroupLocationsQueryKey, getGetGroupMembersQueryKey, getGetMeetingPointQueryKey } from "@workspace/api-client-react";
import { getInviteUrl, getMemberColor, formatRelativeTime, formatTime, formatDistance, getDistanceMeters } from "@/lib/utils";
import { clearSession, type GroupSession } from "@/lib/session";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  Users, MessageSquare, Info, Copy, LogOut, MapPin, X,
  Wifi, WifiOff, AlertTriangle, ChevronLeft, ChevronRight, Navigation
} from "lucide-react";

interface Member {
  id: string;
  name: string;
  isLocationSharing: boolean;
  joinedAt: string;
}

interface MemberLocation {
  memberId: string;
  memberName: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updatedAt: string;
  isSharing: boolean;
}

interface Message {
  id: string;
  memberId: string | null;
  memberName: string;
  content: string;
  type: string;
  createdAt: string;
}

interface MeetingPoint {
  latitude: number;
  longitude: number;
  label?: string | null;
  setByName: string;
  setAt: string;
}

interface SidebarProps {
  session: GroupSession;
  members: Member[];
  locations: MemberLocation[];
  messages: Message[];
  meetingPoint: MeetingPoint | null;
  myPosition: { latitude: number; longitude: number } | null;
  isSharing: boolean;
  onSharingChange: (v: boolean) => void;
  onSetMeetingPoint: () => void;
  onLeave: () => void;
}

type Tab = "members" | "chat" | "info";

export default function Sidebar({
  session, members, locations, messages, meetingPoint, myPosition,
  isSharing, onSharingChange, onSetMeetingPoint, onLeave,
}: SidebarProps) {
  const [tab, setTab] = useState<Tab>("members");
  const [collapsed, setCollapsed] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const leaveGroup = useLeaveGroup();
  const updateSharing = useUpdateLocationSharing();
  const sendMessage = useSendMessage();
  const clearMeetingPoint = useClearMeetingPoint();

  // Auto-scroll chat
  useEffect(() => {
    if (tab === "chat") {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, tab]);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendMessage.mutate(
      { groupId: session.groupId, data: { content: chatInput.trim() } },
      { onSuccess: () => setChatInput("") }
    );
  };

  const handleToggleSharing = () => {
    const next = !isSharing;
    onSharingChange(next);
    updateSharing.mutate(
      { groupId: session.groupId, data: { isSharing: next } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetGroupLocationsQueryKey(session.groupId) });
          queryClient.invalidateQueries({ queryKey: getGetGroupMembersQueryKey(session.groupId) });
        },
      }
    );
  };

  const handleLeave = () => {
    leaveGroup.mutate(
      { groupId: session.groupId },
      {
        onSuccess: () => {
          clearSession();
          onLeave();
          setLocation("/");
        },
      }
    );
  };

  const handleClearMeeting = () => {
    clearMeetingPoint.mutate(
      { groupId: session.groupId },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetMeetingPointQueryKey(session.groupId) }) }
    );
  };

  const locationMap = new Map(locations.map(l => [l.memberId, l]));

  const distToMeeting = myPosition && meetingPoint
    ? getDistanceMeters(myPosition.latitude, myPosition.longitude, meetingPoint.latitude, meetingPoint.longitude)
    : null;

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-3 p-2 bg-sidebar border-r border-sidebar-border h-full">
        <button
          onClick={() => setCollapsed(false)}
          className="p-2 rounded-lg hover:bg-sidebar-accent text-sidebar-foreground"
          data-testid="button-expand-sidebar"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {(["members", "chat", "info"] as Tab[]).map((t) => {
          const icons = { members: Users, chat: MessageSquare, info: Info };
          const Icon = icons[t];
          return (
            <button key={t} onClick={() => { setTab(t); setCollapsed(false); }}
              className={cn("p-2 rounded-lg transition-colors", tab === t ? "bg-primary/20 text-primary" : "hover:bg-sidebar-accent text-sidebar-foreground")}
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-72 bg-sidebar border-r border-sidebar-border h-full shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-sidebar-foreground truncate">{session.groupName}</h2>
          <p className="text-xs text-muted-foreground">{members.length} member{members.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1.5 rounded-lg hover:bg-sidebar-accent text-muted-foreground"
          data-testid="button-collapse-sidebar"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-sidebar-border">
        {(["members", "chat", "info"] as Tab[]).map((t) => {
          const icons = { members: Users, chat: MessageSquare, info: Info };
          const Icon = icons[t];
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              data-testid={`tab-${t}`}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors",
                tab === t ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-sidebar-foreground"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {/* Members tab */}
        {tab === "members" && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {/* Location sharing toggle */}
            <div className="flex items-center justify-between p-3 bg-sidebar-accent rounded-lg">
              <div className="flex items-center gap-2">
                {isSharing ? <Wifi className="w-4 h-4 text-green-400" /> : <WifiOff className="w-4 h-4 text-muted-foreground" />}
                <span className="text-xs font-medium text-sidebar-foreground">
                  {isSharing ? "Sharing location" : "Location hidden"}
                </span>
              </div>
              <button
                onClick={handleToggleSharing}
                data-testid="button-toggle-sharing"
                className={cn(
                  "relative w-9 h-5 rounded-full transition-colors",
                  isSharing ? "bg-green-500" : "bg-muted"
                )}
              >
                <span className={cn(
                  "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                  isSharing ? "translate-x-4" : "translate-x-0.5"
                )} />
              </button>
            </div>

            {/* Meeting point */}
            {meetingPoint && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-amber-300">
                        {meetingPoint.label || "Meeting Point"}
                      </p>
                      <p className="text-xs text-muted-foreground">Set by {meetingPoint.setByName}</p>
                      {distToMeeting !== null && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Navigation className="w-3 h-3 text-amber-400" />
                          <span className="text-xs text-amber-300">{formatDistance(distToMeeting)} away</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <button onClick={handleClearMeeting} className="text-muted-foreground hover:text-foreground shrink-0" data-testid="button-clear-meeting">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Set meeting point */}
            <button
              onClick={onSetMeetingPoint}
              data-testid="button-set-meeting-point"
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-sidebar-foreground bg-sidebar-accent hover:bg-sidebar-accent/80 border border-sidebar-border transition-colors"
            >
              <MapPin className="w-3.5 h-3.5 text-amber-400" />
              {meetingPoint ? "Move Meeting Point" : "Set Meeting Point"}
            </button>

            {/* Member list */}
            {members.map((m, idx) => {
              const loc = locationMap.get(m.id);
              const isMe = m.id === session.memberId;
              const color = getMemberColor(idx);
              return (
                <div
                  key={m.id}
                  className={cn(
                    "flex items-center gap-3 p-2.5 rounded-lg",
                    isMe ? "bg-primary/10 border border-primary/20" : "bg-sidebar-accent/50"
                  )}
                  data-testid={`member-card-${m.id}`}
                >
                  <div
                    className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ background: color }}
                  >
                    {m.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-sidebar-foreground truncate">
                      {m.name}{isMe ? " (you)" : ""}
                    </p>
                    <p className={cn("text-xs", loc?.isSharing ? "text-green-400" : "text-muted-foreground")}>
                      {loc?.isSharing
                        ? `Updated ${formatRelativeTime(loc.updatedAt)}`
                        : "Not sharing"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Chat tab */}
        {tab === "chat" && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {messages.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No messages yet. Say hello!</p>
                </div>
              )}
              {messages.map((msg) => {
                const isMe = msg.memberId === session.memberId;
                const isSystem = msg.type !== "chat";
                const isSos = msg.type === "sos";

                if (isSystem) {
                  return (
                    <div key={msg.id} className="text-center" data-testid={`message-${msg.id}`}>
                      <span className={cn(
                        "inline-block text-xs px-3 py-1 rounded-full",
                        isSos
                          ? "bg-red-500/20 text-red-400 font-semibold border border-red-500/30"
                          : "bg-sidebar-accent text-muted-foreground"
                      )}>
                        {isSos && <AlertTriangle className="inline w-3 h-3 mr-1" />}
                        {msg.content}
                      </span>
                      <p className="text-xs text-muted-foreground/50 mt-0.5">{formatTime(msg.createdAt)}</p>
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className={cn("flex flex-col gap-0.5", isMe ? "items-end" : "items-start")} data-testid={`message-${msg.id}`}>
                    {!isMe && <p className="text-xs text-muted-foreground px-1">{msg.memberName}</p>}
                    <div className={cn(
                      "max-w-[85%] px-3 py-1.5 rounded-xl text-xs",
                      isMe
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-sidebar-accent text-sidebar-foreground rounded-bl-sm"
                    )}>
                      {msg.content}
                    </div>
                    <p className="text-xs text-muted-foreground/50 px-1">{formatTime(msg.createdAt)}</p>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleSendMessage} className="p-3 border-t border-sidebar-border flex gap-2">
              <input
                data-testid="input-chat-message"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Message..."
                maxLength={2000}
                className="flex-1 bg-sidebar-accent border border-sidebar-border rounded-lg px-3 py-1.5 text-xs text-sidebar-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <button
                data-testid="button-send-message"
                type="submit"
                disabled={!chatInput.trim() || sendMessage.isPending}
                className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </div>
        )}

        {/* Info tab */}
        {tab === "info" && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Group Name</p>
              <p className="text-sm font-semibold text-sidebar-foreground">{session.groupName}</p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Invite Code</p>
              <div className="flex items-center gap-2 p-2.5 bg-sidebar-accent rounded-lg border border-sidebar-border">
                <span className="text-sm font-mono font-bold text-primary tracking-widest flex-1">
                  {session.inviteCode}
                </span>
                <button
                  onClick={() => copy(session.inviteCode, "code")}
                  data-testid="button-copy-code"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              {copied === "code" && <p className="text-xs text-green-400 mt-1">Copied!</p>}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Invite Link</p>
              <div className="flex items-center gap-2 p-2.5 bg-sidebar-accent rounded-lg border border-sidebar-border">
                <span className="text-xs text-muted-foreground flex-1 truncate">
                  {getInviteUrl(session.inviteCode)}
                </span>
                <button
                  onClick={() => copy(getInviteUrl(session.inviteCode), "link")}
                  data-testid="button-copy-link"
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              {copied === "link" && <p className="text-xs text-green-400 mt-1">Copied!</p>}
            </div>

            <div className="pt-4 border-t border-sidebar-border">
              <button
                onClick={handleLeave}
                data-testid="button-leave-group"
                disabled={leaveGroup.isPending}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium text-destructive border border-destructive/30 hover:bg-destructive/10 transition-colors disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                {leaveGroup.isPending ? "Leaving..." : "Leave Group"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
