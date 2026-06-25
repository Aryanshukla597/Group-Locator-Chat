import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLeaveGroup, useUpdateLocationSharing, useSendMessage, useClearMeetingPoint, usePinMessage, useMarkMessagesRead, useEditMessage, useDeleteMessage } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetGroupLocationsQueryKey, getGetGroupMembersQueryKey, getGetMeetingPointQueryKey, getGetGroupQueryKey, getListMessagesQueryKey } from "@workspace/api-client-react";
import { getInviteUrl, getMemberColor, formatTime, formatDistance, getDistanceMeters } from "@/lib/utils";
import { clearSession, type GroupSession } from "@/lib/session";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Users, MessageSquare, Info, Copy, LogOut, MapPin, X,
  Wifi, WifiOff, AlertTriangle, ChevronLeft, ChevronRight, Navigation, Lock, Unlock, Send, Smile,
  MoreVertical, UserMinus, UserPlus, Trash2
} from "lucide-react";

const STICKERS: Record<string, React.ReactNode> = {
  explorer: (
    <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M50 15C33.4 15 20 28.4 20 45C20 66.8 50 85 50 85C50 85 80 66.8 80 45C80 28.4 66.6 15 50 15ZM50 55C44.5 55 40 50.5 40 45C40 39.5 44.5 35 50 35C55.5 35 60 39.5 60 45C60 50.5 55.5 55 50 55Z" fill="#10B981" />
      <circle cx="50" cy="45" r="5" fill="white" />
    </svg>
  ),
  siren: (
    <svg className="w-12 h-12 animate-pulse" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M50 10C35 10 25 22 25 35V50H75V35C75 22 65 10 50 10Z" fill="#3B82F6" />
      <rect x="20" y="50" width="60" height="15" rx="5" fill="#EF4444" />
      <path d="M30 65L20 85H80L70 65H30Z" fill="#6B7280" />
      <circle cx="50" cy="30" r="10" fill="#FFE082" />
    </svg>
  ),
  medical: (
    <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 35C12 21.2 23.2 10 37 10C45.3 10 52.8 14.1 57.3 20.3C61.8 14.1 69.3 10 77.6 10C91.4 10 102.6 21.2 102.6 35C102.6 57.6 57.3 90 57.3 90C57.3 90 12 57.6 12 35Z" fill="#EC4899" transform="scale(0.8) translate(12, 12)" />
      <rect x="38" y="25" width="12" height="34" rx="2" fill="white" />
      <rect x="27" y="36" width="34" height="12" rx="2" fill="white" />
    </svg>
  ),
  fire: (
    <svg className="w-12 h-12 animate-bounce" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M50 10C50 10 75 32 75 58C75 71.8 63.8 83 50 83C36.2 83 25 71.8 25 58C25 32 50 10 50 10Z" fill="#F59E0B" />
      <path d="M50 30C50 30 65 47 65 65C65 73.3 58.3 80 50 80C41.7 80 35 73.3 35 65C35 47 50 30 50 30Z" fill="#EF4444" />
      <path d="M50 50C50 50 58 60 58 70C58 74.4 54.4 78 50 78C45.6 78 42 74.4 42 70C42 60 50 50 50 50Z" fill="#FBBF24" />
    </svg>
  ),
  rocket: (
    <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M65 15C50 25 40 45 40 60L55 75C70 75 90 65 100 50C100 50 85 45 65 15Z" fill="#E2E8F0" transform="scale(0.8) translate(10, 10)" />
      <path d="M25 90L40 75L50 85L25 90Z" fill="#F59E0B" />
      <path d="M60 40C57.2 40 55 37.8 55 35C55 32.2 57.2 30 60 30C62.8 30 65 32.2 65 35C65 37.8 62.8 40 60 40Z" fill="#3B82F6" />
    </svg>
  ),
  target: (
    <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 90L45 40L45 10H55L55 90H20Z" fill="#94A3B8" />
      <path d="M48 15V45L85 30L48 15Z" fill="#EF4444" />
      <circle cx="45" cy="90" r="10" fill="#64748B" />
    </svg>
  )
};

interface Member {
  id: string;
  name: string;
  isLocationSharing: boolean;
  isOnline?: boolean;
  isActive?: boolean;
  role: "owner" | "admin" | "member";
  lastReadMessageId?: string | null;
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
  isOnline: boolean;
}

interface Message {
  id: string;
  memberId: string | null;
  memberName: string;
  content: string;
  type: string;
  isPinned: boolean;
  replyToId?: string | null;
  replyToName?: string | null;
  replyToContent?: string | null;
  isEdited?: boolean;
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
  isAdmin: boolean;
  isLocked: boolean;
  onSharingChange: (v: boolean) => void;
  onSetMeetingPoint: () => void;
  onLeave: () => void;
  collapsed: boolean;
  onCollapseChange: (collapsed: boolean) => void;
}

type Tab = "members" | "chat" | "info";

function formatLastSeen(isoString: string | undefined | null): string {
  if (!isoString) return "long time ago";
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (isNaN(then)) return "long time ago";

  const diffMs = now - then;
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));

  if (diffSec < 60) return "just now";
  if (diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    return `${mins} min ago`;
  }
  const hours = Math.floor(diffSec / 3600);
  if (hours < 24) {
    return `${hours} hr ago`;
  }
  return "long time ago";
}

const isValidCoords = (lat?: number | null, lng?: number | null): boolean => {
  return (
    lat !== null &&
    lat !== undefined &&
    lng !== null &&
    lng !== undefined &&
    !(lat === 0 && lng === 0) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    lat !== 999 &&
    lng !== 999
  );
};

const isLocationRecent = (updatedAtStr?: string | null): boolean => {
  if (!updatedAtStr) return false;
  try {
    const lastUpdate = new Date(updatedAtStr).getTime();
    const now = Date.now();
    // 5 minutes = 300,000 milliseconds
    return now - lastUpdate <= 300000;
  } catch (e) {
    return false;
  }
};


export default function Sidebar({
  session, members, locations, messages, meetingPoint, myPosition,
  isSharing, isAdmin, isLocked, onSharingChange, onSetMeetingPoint, onLeave,
  collapsed, onCollapseChange
}: SidebarProps) {
  const [tab, setTab] = useState<Tab>("members");
  const { toast } = useToast();
  const [chatInput, setChatInput] = useState("");

  // Periodically refresh relative last seen timestamps in UI
  const [, setTimeTicker] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeTicker(t => t + 1);
    }, 15000);
    return () => clearInterval(interval);
  }, []);
  const [copied, setCopied] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const pinMessage = usePinMessage();
  const markRead = useMarkMessagesRead();
  const editMessage = useEditMessage();
  const deleteMessage = useDeleteMessage();

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTab, setPickerTab] = useState<"emojis" | "stickers">("emojis");

  // Platform detection & state
  const [isMobile, setIsMobile] = useState(false);
  const [openMenuMessageId, setOpenMenuMessageId] = useState<string | null>(null);
  const [openMemberMenuId, setOpenMemberMenuId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<Record<string, number>>({});

  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeMessageIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close the emoji/sticker picker when clicking outside
  useEffect(() => {
    if (!showPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPicker]);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Mobile Swipe to reply & Long press handlers
  const handleTouchStartAll = (e: React.TouchEvent, msgId: string) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    swipeMessageIdRef.current = msgId;

    // Long press detection
    longPressTimerRef.current = setTimeout(() => {
      setOpenMenuMessageId(msgId);
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, 500);
  };

  const handleTouchMoveAll = (e: React.TouchEvent, msg: Message) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }

    if (!touchStartRef.current || swipeMessageIdRef.current !== msg.id) return;
    const touch = e.touches[0];
    const diffX = touch.clientX - touchStartRef.current.x;
    const diffY = touch.clientY - touchStartRef.current.y;

    if (Math.abs(diffX) > Math.abs(diffY) && diffX > 0) {
      const offset = Math.min(diffX, 75);
      setSwipeOffset(prev => ({ ...prev, [msg.id]: offset }));
    }
  };

  const handleTouchEndAll = (msg: Message) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }

    const currentOffset = swipeOffset[msg.id] || 0;
    if (currentOffset >= 50) {
      setReplyTo(msg);
      inputRef.current?.focus();
      if (navigator.vibrate) {
        navigator.vibrate(30);
      }
    }

    setSwipeOffset(prev => {
      const next = { ...prev };
      delete next[msg.id];
      return next;
    });

    touchStartRef.current = null;
    swipeMessageIdRef.current = null;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setChatInput(val);
  };

  const currentMember = members.find((m) => m.id === session.memberId);
  const currentRole = currentMember?.role ?? "member";
  const canManageMeetingPoint = currentRole === "owner" || currentRole === "admin";

  const leaveGroup = useLeaveGroup();
  const updateSharing = useUpdateLocationSharing();
  const sendMessage = useSendMessage();
  const clearMeetingPoint = useClearMeetingPoint();
  const [lockPending, setLockPending] = useState(false);

  const handleLockToggle = async () => {
    setLockPending(true);
    try {
      await fetch(`/api/groups/${session.groupId}/lock`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ isLocked: !isLocked }),
      });
      queryClient.invalidateQueries({ queryKey: getGetGroupQueryKey(session.groupId) });
    } finally {
      setLockPending(false);
    }
  };

  const [endPending, setEndPending] = useState(false);

  const handleEndSharing = async () => {
    if (!window.confirm("Are you sure you want to end group sharing? All members will be removed, and the group will be closed permanently.")) {
      return;
    }
    setEndPending(true);
    try {
      const response = await fetch(`/api/groups/${session.groupId}/end`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
      });
      if (response.ok) {
        clearSession();
        onLeave();
        setLocation("/");
      } else {
        alert("Failed to end sharing.");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to end sharing.");
    } finally {
      setEndPending(false);
    }
  };

  // Auto-scroll chat
  useEffect(() => {
    if (tab === "chat") {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, tab]);

  const copy = (text: string, key: string) => {
    const fallbackCopy = (val: string): boolean => {
      const textArea = document.createElement("textarea");
      textArea.value = val;
      textArea.style.position = "fixed";
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (err) {
        console.error("Fallback copy failed:", err);
      }
      document.body.removeChild(textArea);
      return ok;
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(text)
        .then(() => {
          setCopied(key);
          setTimeout(() => setCopied(null), 2000);
        })
        .catch((err) => {
          console.warn("Clipboard API failed, using fallback:", err);
          if (fallbackCopy(text)) {
            setCopied(key);
            setTimeout(() => setCopied(null), 2000);
          }
        });
    } else {
      if (fallbackCopy(text)) {
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
      }
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendMessage.mutate(
      {
        groupId: session.groupId,
        data: {
          content: chatInput.trim(),
          replyToId: replyTo ? replyTo.id : undefined
        } as any
      },
      {
        onSuccess: () => {
          setChatInput("");
          setReplyTo(null);
        }
      }
    );
  };

  const handleToggleSharing = () => {
    const next = !isSharing;
    onSharingChange(next);
    // NOTE: No invalidateQueries — the WebSocket `location_sharing_changed` event
    // already patches locations + members cache in-memory (see GroupPage handleWsMessage).
    updateSharing.mutate(
      { groupId: session.groupId, data: { isSharing: next } }
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

  // Memoize locationMap — rebuilding a Map on every render is wasteful when only one member updates
  const locationMap = useMemo(
    () => new Map(locations.map(l => [l.memberId, l])),
    [locations]
  );

  // Compute live-position-aware location for the current user without mutating the cache
  const myLocRaw = locationMap.get(session.memberId);
  const myLoc = myLocRaw
    ? myPosition
      ? { ...myLocRaw, latitude: myPosition.latitude, longitude: myPosition.longitude, updatedAt: new Date().toISOString() }
      : myLocRaw
    : undefined;
  // Patch the locationMap with the live-position override for display purposes only
  const displayLocationMap = useMemo(() => {
    if (!myLoc || !myLocRaw) return locationMap;
    const m = new Map(locationMap);
    m.set(session.memberId, myLoc as typeof myLocRaw);
    return m;
  }, [locationMap, myLoc, myLocRaw, session.memberId]);

  const distToMeeting = myPosition && meetingPoint
    ? getDistanceMeters(myPosition.latitude, myPosition.longitude, meetingPoint.latitude, meetingPoint.longitude)
    : null;

  const handleEditMessage = (messageId: string, content: string) => {
    editMessage.mutate(
      { groupId: session.groupId, messageId, data: { content } },
      {
        onSuccess: () => {
          setEditingMessageId(null);
          // Patch cache directly instead of triggering a full REST refetch
          queryClient.setQueryData(getListMessagesQueryKey(session.groupId), (prev: any) => {
            if (!Array.isArray(prev)) return prev;
            return prev.map((m: any) => m.id === messageId ? { ...m, content, isEdited: true } : m);
          });
        }
      }
    );
  };

  const handleDeleteMessage = (messageId: string) => {
    if (window.confirm("Are you sure you want to delete this message?")) {
      deleteMessage.mutate(
        { groupId: session.groupId, messageId },
        {
          onSuccess: () => {
            // Remove from cache directly instead of triggering a full REST refetch
            queryClient.setQueryData(getListMessagesQueryKey(session.groupId), (prev: any) => {
              if (!Array.isArray(prev)) return prev;
              return prev.filter((m: any) => m.id !== messageId);
            });
          }
        }
      );
    }
  };

  // Mark read receipt effect
  const lastReadMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (tab === "chat" && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.id !== lastReadMessageIdRef.current) {
        lastReadMessageIdRef.current = lastMsg.id;
        markRead.mutate({
          groupId: session.groupId,
          data: { messageId: lastMsg.id }
        }, {
          onSuccess: () => {
            // Patch the members cache directly to avoid a full REST refetch
            queryClient.setQueryData(getGetGroupMembersQueryKey(session.groupId), (prev: any) => {
              if (!Array.isArray(prev)) return prev;
              return prev.map((m: any) =>
                m.id === session.memberId ? { ...m, lastReadMessageId: lastMsg.id } : m
              );
            });
          }
        });
      }
    }
  }, [tab, messages, session.groupId, session.memberId, markRead, queryClient]);

  // Precompute message indices to reduce findIndex lookups from O(M) to O(1)
  const messageIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < messages.length; i++) {
      map.set(messages[i].id, i);
    }
    return map;
  }, [messages]);

  // Precompute maximum index read by other group members in O(K) time
  const maxOtherReadIndex = useMemo(() => {
    let maxIdx = -1;
    for (const m of members) {
      if (m.id === session.memberId) continue;
      if (!m.lastReadMessageId) continue;
      const idx = messageIndexMap.get(m.lastReadMessageId);
      if (idx !== undefined && idx > maxIdx) {
        maxIdx = idx;
      }
    }
    return maxIdx;
  }, [members, session.memberId, messageIndexMap]);

  // Precompute whether any other member is online in O(K) time
  const isAnotherOnline = useMemo(() => {
    return members.some(m => m.id !== session.memberId && m.isOnline);
  }, [members, session.memberId]);

  // Precompute member original indices in O(K) time to map sorted list to original index colors
  const memberOriginalIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < members.length; i++) {
      map.set(members[i].id, i);
    }
    return map;
  }, [members]);

  const renderReadReceipt = (msg: Message) => {
    const isMe = msg.memberId === session.memberId;
    if (!isMe) return null;

    const msgIdx = messageIndexMap.get(msg.id);
    const hasAnyRead = msgIdx !== undefined && msgIdx <= maxOtherReadIndex;

    if (hasAnyRead) {
      return <span className="text-blue-400 ml-1 font-bold text-[10px]" title="Read">✓✓</span>;
    }

    if (isAnotherOnline) {
      return <span className="text-muted-foreground/60 ml-1 font-bold text-[10px]" title="Delivered">✓✓</span>;
    }

    return <span className="text-muted-foreground/40 ml-1 font-bold text-[10px]" title="Sent">✓</span>;
  };

  if (collapsed) {
    return (
      <div className="hidden md:flex flex-col items-center gap-4 p-3 bg-slate-950/80 backdrop-blur-xl border-r border-white/10 h-full shrink-0">
        <button
          onClick={() => onCollapseChange(false)}
          className="p-2.5 rounded-xl hover:bg-white/10 text-slate-300 hover:text-white transition-all duration-200"
          data-testid="button-expand-sidebar"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {(["members", "chat", "info"] as Tab[]).map((t) => {
          const icons = { members: Users, chat: MessageSquare, info: Info };
          const Icon = icons[t];
          return (
            <button key={t} onClick={() => { setTab(t); onCollapseChange(false); }}
              className={cn("p-2.5 rounded-xl transition-all duration-200", tab === t ? "bg-primary/20 text-primary shadow-glow-primary" : "hover:bg-white/5 text-slate-400 hover:text-white")}
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="absolute md:relative md:flex z-[1050] md:z-50 flex flex-col w-72 md:w-72 bg-slate-950/95 md:bg-slate-950/85 backdrop-blur-xl border-r border-white/10 h-full shrink-0 animate-in slide-in-from-left duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4.5 py-4 border-b border-white/5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-extrabold text-white tracking-wide truncate">{session.groupName}</h2>
            {isLocked && (
              <Lock className="w-3 h-3 text-amber-400 shrink-0" />
            )}
          </div>
          <p className="text-[11px] font-medium text-slate-400 mt-0.5">{members.length} member{members.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => onCollapseChange(true)}
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          data-testid="button-collapse-sidebar"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="p-1.5 bg-slate-900/40 border-b border-white/5 flex gap-1">
        {(["members", "chat", "info"] as Tab[]).map((t) => {
          const icons = { members: Users, chat: MessageSquare, info: Info };
          const Icon = icons[t];
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              data-testid={`tab-${t}`}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all duration-300 relative select-none",
                active 
                  ? "bg-primary text-primary-foreground shadow-glow-primary scale-102 font-bold" 
                  : "text-slate-400 hover:text-white hover:bg-white/5"
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
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2.5">
            {/* Location sharing toggle */}
            <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl shadow-sm">
              <div className="flex items-center gap-2">
                {isSharing 
                  ? <Wifi className="w-4 h-4 text-emerald-400 animate-pulse" /> 
                  : <WifiOff className="w-4 h-4 text-slate-400" />
                }
                <span className="text-xs font-semibold text-slate-200">
                  {isSharing ? "Sharing live location" : "Location paused"}
                </span>
              </div>
              <button
                onClick={handleToggleSharing}
                data-testid="button-toggle-sharing"
                className={cn(
                  "relative w-10 h-6 rounded-full transition-all duration-300 focus:outline-none shrink-0",
                  isSharing ? "bg-emerald-500 shadow-glow-emerald" : "bg-slate-800"
                )}
              >
                <span className={cn(
                  "absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform duration-300",
                  isSharing ? "translate-x-4" : "translate-x-0"
                )} />
              </button>
            </div>

            {/* Meeting point */}
            {meetingPoint && (
              <div className="p-3.5 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20 shadow-inner rounded-xl space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-amber-300 leading-tight">
                        {meetingPoint.label || "Meeting Point"}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Set by {meetingPoint.setByName}</p>
                      {distToMeeting !== null && (
                        <div className="flex items-center gap-1 mt-1">
                          <Navigation className="w-3.5 h-3.5 text-amber-400 fill-amber-400/20 animate-pulse" />
                          <span className="text-xs font-bold text-amber-300">{formatDistance(distToMeeting)} away</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0 items-center">
                    {myPosition && (
                      <button 
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent("route-to-meeting-point"));
                        }}
                        className="p-1.5 text-amber-400 hover:bg-amber-500/20 rounded-lg transition-colors"
                        title="Get Route Directions"
                      >
                        <Navigation className="w-3.5 h-3.5 fill-current" />
                      </button>
                    )}
                    {canManageMeetingPoint && (
                      <button onClick={handleClearMeeting} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-colors" data-testid="button-clear-meeting">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Set meeting point */}
            {canManageMeetingPoint && (
              <button
                onClick={onSetMeetingPoint}
                data-testid="button-set-meeting-point"
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-amber-400 bg-amber-500/5 hover:bg-amber-500/12 border border-amber-500/20 hover:border-amber-500/40 transition-all duration-200"
              >
                <MapPin className="w-3.5 h-3.5 text-amber-400" />
                {meetingPoint ? "Move Meeting Point" : "Set Meeting Point"}
              </button>
            )}

            {/* Member list */}
            {(() => {
              const sortedMembers = [...members].sort((a, b) => {
                if (a.id === session.memberId) return -1;
                if (b.id === session.memberId) return 1;
                return 0;
              });

              return sortedMembers.map((m) => {
                const originalIdx = memberOriginalIndexMap.get(m.id) ?? -1;
                const loc = displayLocationMap.get(m.id);
                const isMe = m.id === session.memberId;
                const color = getMemberColor(originalIdx);

                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-center gap-3.5 p-3 rounded-xl border transition-all duration-300 relative group",
                      isMe 
                        ? "bg-primary/8 border-primary/25 shadow-sm" 
                        : "bg-white/4 border-white/5 hover:bg-white/8 hover:border-white/10",
                      !isMe && loc?.isSharing ? "cursor-pointer" : ""
                    )}
                    data-testid={`member-card-${m.id}`}
                    title={!isMe && loc?.isSharing ? `Navigate to ${m.name}'s location` : undefined}
                    onClick={() => {
                      if (isMe) return;

                      const latestLoc = displayLocationMap.get(m.id);
                      if (!latestLoc || !latestLoc.isSharing) {
                        toast({
                          title: "Location Sharing Disabled",
                          description: `${m.name} is not sharing location currently.`,
                          variant: "destructive"
                        });
                        return;
                      }

                      const lat = latestLoc.latitude;
                      const lng = latestLoc.longitude;

                      // Validation Rule: ensure coordinates exist, are not null/undefined, and are not default/fake (0,0 or 999)
                      const isValidCoords = (
                        lat !== null &&
                        lat !== undefined &&
                        lng !== null &&
                        lng !== undefined &&
                        !(lat === 0 && lng === 0) &&
                        Math.abs(lat) <= 90 &&
                        Math.abs(lng) <= 180 &&
                        lat !== 999 &&
                        lng !== 999
                      );

                      if (!isValidCoords) {
                        toast({
                          title: "Live Location Not Available",
                          description: `Live location is not available for ${m.name}.`,
                          variant: "destructive"
                        });
                        return;
                      }

                      // Check if location is recently updated (within last 2 minutes)
                      const isRecent = isLocationRecent(latestLoc.updatedAt);

                      if (!isRecent) {
                        // Use last known location as approximate fallback
                        toast({
                          title: "Using Last Known Location",
                          description: `Showing route to ${m.name}'s approximate last known location.`,
                        });
                      }

                      const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
                      window.open(url, "_blank", "noopener,noreferrer");
                    }}
                  >
                      <div className="relative shrink-0">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-md"
                        style={{ background: `linear-gradient(135deg, ${color}, ${color}aa)` }}
                      >
                        {m.name.slice(0, 2).toUpperCase()}
                      </div>
                      {m.isOnline && m.isActive && (
                        <span className="absolute bottom-0 right-0 block w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-slate-950 shadow-glow-emerald animate-pulse" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0 w-full">
                        <span className="text-xs font-bold text-slate-100 truncate min-w-0">
                          {m.name}{isMe ? " (you)" : ""}
                        </span>
                        {m.role === "admin" && (
                          <span className="shrink-0 text-[7.5px] font-black px-1.5 py-0.5 rounded-md bg-gradient-to-r from-sky-400 to-indigo-500 text-white border border-sky-400/30 uppercase tracking-wider leading-none shadow-sm shadow-sky-500/25 shadow-glow-primary">
                            Admin
                          </span>
                        )}
                        {m.role === "owner" && (
                          <span className="shrink-0 text-[7.5px] font-black px-1.5 py-0.5 rounded-md bg-gradient-to-r from-amber-400 to-orange-500 text-white border border-amber-400/30 uppercase tracking-wider leading-none shadow-sm shadow-amber-500/25">
                            Creator
                          </span>
                        )}
                      </div>
                      <p className={cn("text-[11px] font-medium mt-0.5", (loc?.isOnline && loc.isSharing) ? (isLocationRecent(loc.updatedAt) && isValidCoords(loc.latitude, loc.longitude) ? "text-emerald-400" : "text-amber-400") : "text-slate-400")}>
                        {loc?.isOnline
                          ? loc.isSharing
                            ? isLocationRecent(loc.updatedAt) && isValidCoords(loc.latitude, loc.longitude)
                              ? "Online"
                              : "Location approximate"
                            : "Location paused"
                          : `Last seen ${formatLastSeen(loc?.updatedAt)}`}
                      </p>
                    </div>
                    {!isMe && loc?.latitude !== null && loc?.longitude !== null && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!loc || loc.latitude === null || loc.longitude === null) return;
                          setTab("chat");
                          setChatInput((prev) => {
                            const mention = `@${m.name} (Last location: ${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}) `;
                            return prev ? prev + " " + mention : mention;
                          });
                        }}
                        title="Mention location in chat"
                        className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-primary transition-all shrink-0 flex md:hidden md:group-hover:inline-flex md:focus:inline-flex"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {!isMe && currentRole === "owner" && (
                      <div className="relative shrink-0 flex items-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMemberMenuId(openMemberMenuId === m.id ? null : m.id);
                          }}
                          title="Member Options"
                          className={cn(
                            "p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-all shrink-0",
                            openMemberMenuId === m.id ? "bg-white/10 text-slate-200" : "flex md:hidden md:group-hover:inline-flex md:focus:inline-flex"
                          )}
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                        {openMemberMenuId === m.id && (
                          <>
                            <div
                              className="fixed inset-0 z-40 cursor-default"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMemberMenuId(null);
                              }}
                            />
                            <div
                              className="absolute right-0 top-full mt-1 w-32 py-1 bg-slate-900 border border-white/10 rounded-lg shadow-xl z-50 animate-in fade-in slide-in-from-top-1 duration-150"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setOpenMemberMenuId(null);
                                  const newRole = m.role === "admin" ? "member" : "admin";
                                  try {
                                    const response = await fetch(`/api/groups/${session.groupId}/members/${m.id}/role`, {
                                      method: "POST",
                                      headers: {
                                        "Content-Type": "application/json",
                                        Authorization: `Bearer ${session.token}`,
                                      },
                                      body: JSON.stringify({ role: newRole }),
                                    });
                                    if (response.ok) {
                                      queryClient.invalidateQueries({ queryKey: getGetGroupMembersQueryKey(session.groupId) });
                                    } else {
                                      alert("Failed to change role.");
                                    }
                                  } catch (err) {
                                    console.error(err);
                                    alert("Failed to change role.");
                                  }
                                }}
                                className="w-full px-3 py-1.5 text-left text-xs font-semibold text-slate-200 hover:bg-white/5 hover:text-white transition-colors flex items-center gap-2"
                              >
                                {m.role === "admin" ? (
                                  <>
                                    <UserMinus className="w-3.5 h-3.5 text-amber-400" />
                                    Demote
                                  </>
                                ) : (
                                  <>
                                    <UserPlus className="w-3.5 h-3.5 text-sky-400" />
                                    Promote
                                  </>
                                )}
                              </button>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setOpenMemberMenuId(null);
                                  if (!window.confirm(`Are you sure you want to remove ${m.name} from the group?`)) return;
                                  try {
                                    const response = await fetch(`/api/groups/${session.groupId}/members/${m.id}`, {
                                      method: "DELETE",
                                      headers: {
                                        Authorization: `Bearer ${session.token}`,
                                      },
                                    });
                                    if (response.ok) {
                                      queryClient.invalidateQueries({ queryKey: getGetGroupMembersQueryKey(session.groupId) });
                                    } else {
                                      alert("Failed to remove member.");
                                    }
                                  } catch (err) {
                                    console.error(err);
                                    alert("Failed to remove member.");
                                  }
                                }}
                                className="w-full px-3 py-1.5 text-left text-xs font-semibold text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors flex items-center gap-2"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Remove
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {!isMe && loc?.isSharing && (
                      <Navigation className="w-3.5 h-3.5 text-primary shrink-0 opacity-70 animate-pulse hidden md:block md:group-hover:hidden" />
                    )}
                  </div>
                );
              });
            })()}
          </div>
        )}

        {/* Chat tab */}
        {tab === "chat" && (
          <div className="flex-1 overflow-hidden flex flex-col relative">
            {/* WhatsApp-style Pinned Messages Section (Fixed Banner above chat window) */}
            {messages.filter(m => m.isPinned).length > 0 && (
              <div className="bg-amber-500/10 border-b border-amber-500/20 p-2 shrink-0 z-10 shadow-sm flex flex-col">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">📌 Pinned Messages</span>
                </div>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {messages.filter(m => m.isPinned).map(msg => (
                    <div key={msg.id} className="flex items-start justify-between gap-2 bg-sidebar-accent/50 p-1.5 rounded text-[10px] border border-sidebar-border/30">
                      <div className="min-w-0">
                        <span className="font-semibold text-sidebar-foreground block truncate">{msg.memberName}</span>
                        {msg.content.startsWith("[sticker:") ? (
                          <span className="text-muted-foreground italic">Sticker</span>
                        ) : (
                          <span className="text-muted-foreground break-words">{msg.content}</span>
                        )}
                      </div>
                      {canManageMeetingPoint && (
                        <button
                          onClick={() => {
                            pinMessage.mutate(
                              { groupId: session.groupId, messageId: msg.id, data: { isPinned: false } },
                              { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(session.groupId) }) }
                            );
                          }}
                          title="Unpin"
                          className="text-amber-400 hover:text-red-400 shrink-0 self-center"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Scrollable messages area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3.5 space-y-3 bg-slate-950/20">
              {messages.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No messages yet. Say hello!</p>
                </div>
              )}
              {messages.map((msg) => {
                const isMe = msg.memberId === session.memberId;
                const isSystem = msg.type !== "chat" && !msg.type.startsWith("sos");
                const isSos = msg.type.startsWith("sos");

                if (isSystem) {
                  // Hide role changes and removal messages from chat UI
                  if (
                    msg.content.includes("promoted to Admin") ||
                    msg.content.includes("demoted to Member") ||
                    (msg.content.includes("removed") && msg.content.includes("from the group"))
                  ) {
                    return null;
                  }
                  return (
                    <div key={msg.id} className="text-center" id={`message-${msg.id}`} data-testid={`message-${msg.id}`}>
                      <span className="inline-block text-xs px-3 py-1 rounded-full bg-sidebar-accent text-muted-foreground text-[11px]">
                        {msg.content}
                      </span>
                      <p className="text-[10px] text-muted-foreground/50 mt-0.5">{formatTime(msg.createdAt)}</p>
                    </div>
                  );
                }

                if (isSos) {
                  return (
                    <div key={msg.id} className="text-center animate-pulse" id={`message-${msg.id}`} data-testid={`message-${msg.id}`}>
                      <span className={cn(
                        "inline-block text-xs px-3 py-1 rounded-full font-semibold border text-[11px]",
                        msg.type === "sos_medical" ? "bg-pink-500/20 border-pink-500/30 text-pink-400" :
                        msg.type === "sos_fire" ? "bg-amber-500/20 border-amber-500/30 text-amber-400" :
                        msg.type === "sos_police" ? "bg-blue-500/20 border-blue-500/30 text-blue-400" :
                        "bg-red-500/20 border-red-500/30 text-red-400"
                      )}>
                        <AlertTriangle className="inline w-3 h-3 mr-1" />
                        {msg.content}
                      </span>
                      <p className="text-[10px] text-muted-foreground/50 mt-0.5">{formatTime(msg.createdAt)}</p>
                    </div>
                  );
                }

                const isSticker = msg.content.startsWith("[sticker:") && msg.content.endsWith("]");
                const stickerId = isSticker ? msg.content.slice(9, -1) : "";

                return (
                  <div 
                    key={msg.id} 
                    id={`message-${msg.id}`} 
                    className={cn("flex flex-col gap-0.5", isMe ? "items-end" : "items-start")} 
                    data-testid={`message-${msg.id}`}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    {!isMe && <p className="text-[10px] text-muted-foreground px-1">{msg.memberName}</p>}
                    
                    <div 
                      className={cn("flex items-center gap-1.5 group max-w-[85%]", isMe ? "flex-row" : "flex-row-reverse")}
                      onTouchStart={(e) => handleTouchStartAll(e, msg.id)}
                      onTouchMove={(e) => handleTouchMoveAll(e, msg)}
                      onTouchEnd={() => handleTouchEndAll(msg)}
                      style={{
                        transform: `translateX(${swipeOffset[msg.id] || 0}px)`,
                        transition: swipeOffset[msg.id] ? "none" : "transform 0.2s ease-out"
                      }}
                    >
                      {/* 3-dot dropdown menu for message actions */}
                      <div className="relative shrink-0 select-none">
                        <button
                          type="button"
                          onClick={() => setOpenMenuMessageId(openMenuMessageId === msg.id ? null : msg.id)}
                          className={cn(
                            "p-1.5 rounded-full hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-all duration-200 active:scale-90",
                            openMenuMessageId === msg.id ? "opacity-100 bg-sidebar-accent text-foreground" : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
                          )}
                          title="Message Options"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="1"/>
                            <circle cx="12" cy="5" r="1"/>
                            <circle cx="12" cy="19" r="1"/>
                          </svg>
                        </button>

                        {openMenuMessageId === msg.id && (
                          <>
                            {/* Backdrop overlay to dismiss dropdown menu */}
                            <div 
                              className="fixed inset-0 z-[990]" 
                              onClick={() => setOpenMenuMessageId(null)}
                            />
                            
                            <div className={cn(
                              "absolute bottom-full mb-1 z-[995] min-w-[130px] bg-background/95 backdrop-blur-md border border-border shadow-xl rounded-xl p-1.5 flex flex-col gap-0.5 animate-in fade-in slide-in-from-bottom-2 duration-150",
                              isMe ? "right-0" : "left-0"
                            )}>
                              {/* Reply Option */}
                              <button
                                type="button"
                                onClick={() => {
                                  setReplyTo(msg);
                                  setOpenMenuMessageId(null);
                                  inputRef.current?.focus();
                                }}
                                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-foreground hover:bg-accent transition-colors"
                              >
                                <svg className="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 14L4 9L9 4" /><path d="M20 20v-7a4 4 0 00-4-4H4" /></svg>
                                Reply
                              </button>

                              {/* Edit Option */}
                              {isMe && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingMessageId(msg.id);
                                    setEditingText(msg.content);
                                    setOpenMenuMessageId(null);
                                  }}
                                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-foreground hover:bg-accent transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4Z" /></svg>
                                  Edit
                                </button>
                              )}

                              {/* Pin Message Option */}
                              {canManageMeetingPoint && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    pinMessage.mutate(
                                      { groupId: session.groupId, messageId: msg.id, data: { isPinned: !msg.isPinned } },
                                      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(session.groupId) }) }
                                    );
                                    setOpenMenuMessageId(null);
                                  }}
                                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-foreground hover:bg-accent transition-colors"
                                >
                                  <span className="text-xs">{msg.isPinned ? "📍" : "📌"}</span>
                                  {msg.isPinned ? "Unpin" : "Pin Message"}
                                </button>
                              )}

                              {/* Delete Option */}
                               {(isMe || currentRole === "owner") && (
                                 <button
                                   type="button"
                                   onClick={() => {
                                     handleDeleteMessage(msg.id);
                                     setOpenMenuMessageId(null);
                                   }}
                                   className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-red-500 hover:bg-red-500/10 transition-colors"
                                 >
                                   <X className="w-3.5 h-3.5 text-red-500" />
                                   Delete
                                 </button>
                               )}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Bubble */}
                      <div className={cn(
                        "px-3 py-2 rounded-2xl text-xs flex flex-col shadow-sm max-w-full",
                        isMe
                          ? "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-tr-xs shadow-glow-primary/20"
                          : "bg-white/8 text-slate-100 border border-white/5 rounded-tl-xs"
                      )}>
                        {/* Reply block quote */}
                        {msg.replyToId && (
                          <div
                            onClick={() => {
                              const el = document.getElementById(`message-${msg.replyToId}`);
                              el?.scrollIntoView({ behavior: "smooth", block: "center" });
                              el?.classList.add("bg-primary/20");
                              setTimeout(() => el?.classList.remove("bg-primary/20"), 3000);
                            }}
                            className="mb-1 p-1 bg-black/10 dark:bg-white/10 border-l-2 border-primary/60 rounded text-[10px] cursor-pointer hover:bg-black/20 select-none max-w-full"
                          >
                            <p className="font-bold truncate text-[8px] opacity-80">{msg.replyToName}</p>
                            <p className="truncate max-w-xs opacity-75">{msg.replyToContent?.startsWith("[sticker:") ? "Sticker" : msg.replyToContent}</p>
                          </div>
                        )}

                        {/* Content */}
                        {editingMessageId === msg.id ? (
                          <div className="flex flex-col gap-1.5 p-1 min-w-40">
                            <input
                              type="text"
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              className="bg-black/20 text-white rounded px-2 py-1 text-xs border border-white/20 focus:outline-none"
                            />
                            <div className="flex justify-end gap-1">
                              <button onClick={() => setEditingMessageId(null)} className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] text-white">Cancel</button>
                              <button onClick={() => handleEditMessage(msg.id, editingText)} className="px-1.5 py-0.5 rounded bg-primary text-[10px] text-primary-foreground font-bold">Save</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center">
                            {msg.isPinned && <span className="mr-1 text-[10px]" title="Pinned message">📌</span>}
                            {isSticker && STICKERS[stickerId] ? (
                              STICKERS[stickerId]
                            ) : (
                              <span className="break-words select-text">{msg.content}</span>
                            )}
                            {renderReadReceipt(msg)}
                          </div>
                        )}
                      </div>

                    </div>
                    {/* Timestamp: visible on hover on PC (Desktop), but always visible on mobile */}
                    <p className={cn(
                      "text-[9px] text-muted-foreground/50 px-1 transition-opacity duration-200",
                      isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    )}>
                      {formatTime(msg.createdAt)}
                      {msg.isEdited && <span className="text-[9px] ml-1 opacity-70">(edited)</span>}
                    </p>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleSendMessage} className="p-3 bg-slate-900/30 border-t border-white/5 flex flex-col gap-2 relative">
              {replyTo && (
                <div className="p-2 bg-white/5 border border-white/5 rounded-xl flex items-center justify-between text-[11px] mb-1">
                  <div className="min-w-0 border-l-2 border-primary pl-2">
                    <p className="font-semibold text-slate-200 truncate">{replyTo.memberName}</p>
                    <p className="text-slate-400 truncate">{replyTo.content.startsWith("[sticker:") ? "Sticker" : replyTo.content}</p>
                  </div>
                  <button type="button" onClick={() => setReplyTo(null)} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              <div className="flex gap-1.5 relative items-center">
                <button
                  type="button"
                  onClick={() => setShowPicker(!showPicker)}
                  className={cn(
                    "p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-all duration-200 shrink-0",
                    showPicker ? "bg-white/10 text-white shadow-glow-primary" : ""
                  )}
                  title="Choose Emoji or Sticker"
                >
                  <Smile className="w-4 h-4" />
                </button>
                <input
                  ref={inputRef}
                  data-testid="input-chat-message"
                  value={chatInput}
                  onChange={handleInputChange}
                  placeholder="Message..."
                  maxLength={2000}
                  className="flex-1 min-w-0 bg-white/5 border border-white/5 hover:border-white/10 focus:border-primary/50 focus:ring-primary/20 focus:ring-2 focus:bg-white/8 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-400 focus:outline-none transition-all"
                />
                <button
                  data-testid="button-send-message"
                  type="submit"
                  disabled={!chatInput.trim() || sendMessage.isPending}
                  className="p-2 bg-primary text-primary-foreground rounded-xl disabled:opacity-40 hover:opacity-95 active:scale-98 shadow-glow-primary transition-all shrink-0 flex items-center justify-center"
                  title="Send message"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* WhatsApp-style Unified Emoji/Sticker Picker Popover */}
              {showPicker && (
                <div ref={pickerRef} className="absolute bottom-full left-3 mb-2 bg-slate-950/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl flex flex-col z-[1000] w-64 overflow-hidden">
                  {/* Tabs Header */}
                  <div className="flex border-b border-white/5 bg-slate-900/30 p-1">
                    {(["emojis", "stickers"] as const).map((tabName) => (
                      <button
                        key={tabName}
                        type="button"
                        onClick={() => setPickerTab(tabName)}
                        className={cn(
                          "flex-1 py-1.5 text-[11px] font-bold rounded-xl transition-all uppercase tracking-wider",
                          pickerTab === tabName
                            ? "bg-white/10 text-white shadow-sm"
                            : "text-slate-400 hover:text-white"
                        )}
                      >
                        {tabName}
                      </button>
                    ))}
                  </div>

                  {/* Tab Body */}
                  <div className="p-2 bg-slate-950/30">
                    {pickerTab === "emojis" ? (
                      <div className="grid grid-cols-6 gap-1.5 max-h-44 overflow-y-auto custom-scrollbar p-1">
                        {[
                          "😀", "😂", "😍", "👍", "🔥", "🎉", "🚀", "📍", "📌", "❤️", "🙌", "👏",
                          "💩", "👀", "🤔", "💡", "⚠️", "❌", "✔️", "✨", "🌟", "😎", "🍿", "🍕",
                          "👋", "🎉", "🎂", "🌈", "⚡", "💯"
                        ].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => {
                              setChatInput(prev => prev + emoji);
                              inputRef.current?.focus();
                            }}
                            className="p-1.5 text-center text-sm hover:bg-white/10 rounded-lg transition-colors"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 max-h-44 overflow-y-auto custom-scrollbar p-1">
                        {Object.keys(STICKERS).map((stickerId) => (
                          <button
                            key={stickerId}
                            type="button"
                            onClick={() => {
                              sendMessage.mutate(
                                { groupId: session.groupId, data: { content: `[sticker:${stickerId}]` } as any },
                                {
                                  onSuccess: () => {
                                    setShowPicker(false);
                                  },
                                  onError: () => {
                                    toast({ title: "Failed to send sticker", description: "Please try again.", variant: "destructive" });
                                  }
                                }
                              );
                            }}
                            className="p-1 hover:bg-white/10 rounded-lg flex items-center justify-center border border-white/5 hover:border-white/10 transition-all"
                          >
                            {STICKERS[stickerId]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </form>
          </div>
        )}

        {/* Info tab */}
        {tab === "info" && (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4.5 space-y-5 bg-slate-950/20">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Group Name</p>
              <p className="text-sm font-bold text-white">{session.groupName}</p>
            </div>

            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Invite Code</p>
              <div className="flex items-center gap-2.5 p-3.5 bg-white/5 border border-white/5 rounded-xl shadow-sm hover:border-white/10 transition-colors">
                <span className="text-sm font-mono font-extrabold text-primary tracking-widest flex-1">
                  {session.inviteCode}
                </span>
                <button
                  onClick={() => copy(session.inviteCode, "code")}
                  data-testid="button-copy-code"
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              {copied === "code" && <p className="text-xs text-emerald-400 mt-1">Copied to clipboard!</p>}
            </div>

            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Invite Link</p>
              <div className="flex items-center gap-2.5 p-3.5 bg-white/5 border border-white/5 rounded-xl shadow-sm hover:border-white/10 transition-colors">
                <span className="text-xs text-slate-400 flex-1 truncate">
                  {getInviteUrl(session.inviteCode)}
                </span>
                <button
                  onClick={() => copy(getInviteUrl(session.inviteCode), "link")}
                  data-testid="button-copy-link"
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              {copied === "link" && <p className="text-xs text-emerald-400 mt-1">Copied to clipboard!</p>}
            </div>

            <div className="pt-5 border-t border-white/5 space-y-3">
              {/* Admin: Lock/Unlock group */}
              {(currentRole === "owner" || currentRole === "admin") && (
                <button
                  onClick={handleLockToggle}
                  disabled={lockPending}
                  data-testid="button-lock-group"
                  className={cn(
                    "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 disabled:opacity-50",
                    isLocked
                      ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/40 shadow-sm"
                      : "bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/40 shadow-sm"
                  )}
                >
                  {isLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  {lockPending ? "Please wait..." : isLocked ? "Unlock Group" : "Lock Group"}
                </button>
              )}
              {/* Admin: End Sharing */}
              {currentRole === "owner" && (
                <button
                  onClick={handleEndSharing}
                  disabled={endPending}
                  data-testid="button-end-sharing"
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold bg-destructive/10 border border-destructive/20 text-red-400 hover:bg-destructive/20 hover:border-destructive/40 transition-all duration-200 disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                  {endPending ? "Ending..." : "End Sharing"}
                </button>
              )}
              <button
                onClick={handleLeave}
                data-testid="button-leave-group"
                disabled={leaveGroup.isPending}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold text-red-400 bg-destructive/5 border border-destructive/10 hover:bg-destructive/12 hover:border-destructive/25 transition-all duration-200 disabled:opacity-50"
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
