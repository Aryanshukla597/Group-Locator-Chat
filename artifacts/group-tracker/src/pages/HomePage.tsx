import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useCreateGroup, useJoinGroup } from "@workspace/api-client-react";
import { saveSession, getOrInitializeUserId } from "@/lib/session";
import { cn } from "@/lib/utils";
import { MapPin, Users, Shield, Zap, AlertTriangle } from "lucide-react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

setAuthTokenGetter(() => {
  try {
    const raw = localStorage.getItem("groupSession");
    if (!raw) return null;
    const { token } = JSON.parse(raw);
    return token ?? null;
  } catch {
    return null;
  }
});

export default function HomePage() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<"create" | "join">(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    return params.get("join") ? "join" : "create";
  });
  const [groupName, setGroupName] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [inviteCode, setInviteCode] = useState(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    return params.get("join") ?? "";
  });
  const [memberName, setMemberName] = useState("");
  const [formError, setFormError] = useState("");

  // Warm up device GPS/location services on page load
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => {}, 
        () => {}, 
        { enableHighAccuracy: false, maximumAge: Infinity, timeout: 2000 }
      );
    }
  }, []);

  const createGroup = useCreateGroup();
  const joinGroup = useJoinGroup();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!groupName.trim() || !creatorName.trim()) {
      setFormError("Please fill in all fields.");
      return;
    }
    const userId = getOrInitializeUserId();
    createGroup.mutate(
      { data: { name: groupName.trim(), creatorName: creatorName.trim(), userId } },
      {
        onSuccess: (result) => {
          saveSession({
            groupId: result.group.id,
            memberId: result.memberId,
            token: result.token,
            memberName: creatorName.trim(),
            groupName: result.group.name,
            inviteCode: result.group.inviteCode,
          });
          setLocation(`/group/${result.group.id}`);
        },
        onError: () => setFormError("Failed to create group. Please try again."),
      }
    );
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!inviteCode.trim() || !memberName.trim()) {
      setFormError("Please fill in all fields.");
      return;
    }
    const userId = getOrInitializeUserId();
    joinGroup.mutate(
      { data: { inviteCode: inviteCode.trim().toUpperCase(), memberName: memberName.trim(), userId } },
      {
        onSuccess: (result) => {
          saveSession({
            groupId: result.group.id,
            memberId: result.memberId,
            token: result.token,
            memberName: memberName.trim(),
            groupName: result.group.name,
            inviteCode: result.group.inviteCode,
          });
          setLocation(`/group/${result.group.id}`);
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error || err?.message || "";
          if (msg.includes("ended")) {
            setFormError("🔒 This group has ended. New members cannot join.");
          } else if (msg.includes("locked")) {
            setFormError("🔒 This group is locked. New members cannot join.");
          } else if (msg.includes("not found") || msg.includes("404")) {
            setFormError("Invalid invite code. Please check and try again.");
          } else {
            setFormError("Failed to join group. Please try again.");
          }
        },
      }
    );
  };

  const isPending = createGroup.isPending || joinGroup.isPending;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Ambient Glow Blobs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Background grid */}
      <div className="fixed inset-0 opacity-[0.03] pointer-events-none"
        style={{ backgroundImage: "linear-gradient(hsl(var(--border)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)", backgroundSize: "40px 40px" }}
      />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4 shadow-glow-primary/20">
            <MapPin className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">FindMy Group</h1>
          <p className="text-slate-400 mt-2 text-sm">Real-time location sharing for your group</p>
        </div>

        {/* Feature badges */}
        <div className="flex gap-2 justify-center mb-8 flex-wrap">
          {[
            { icon: MapPin, label: "Live Maps" },
            { icon: Shield, label: "Secure" },
            { icon: Zap, label: "Real-time" },
            { icon: AlertTriangle, label: "SOS Alerts" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/5 text-xs font-semibold text-slate-300">
              <Icon className="w-3.5 h-3.5 text-primary" />
              {label}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
          {/* Tabs */}
          <div className="flex p-1.5 bg-slate-900/40 border-b border-white/5 gap-1.5">
            {(["create", "join"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setFormError(""); }}
                data-testid={`tab-${t}`}
                className={cn(
                  "flex-1 py-2.5 rounded-2xl text-sm font-bold transition-all duration-300 relative select-none",
                  tab === t
                    ? "bg-primary text-primary-foreground shadow-glow-primary scale-102 font-extrabold"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                )}
              >
                {t === "create" ? "Create Group" : "Join Group"}
              </button>
            ))}
          </div>

          <div className="p-6">
            {tab === "create" ? (
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest">Group Name</label>
                  <input
                    data-testid="input-group-name"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="e.g. Mountain Hike Crew"
                    maxLength={100}
                    className="w-full bg-white/5 border border-white/5 hover:border-white/10 focus:border-primary/50 focus:ring-primary/20 focus:ring-2 focus:bg-white/8 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest">Your Name</label>
                  <input
                    data-testid="input-creator-name"
                    value={creatorName}
                    onChange={(e) => setCreatorName(e.target.value)}
                    placeholder="e.g. Alex"
                    maxLength={50}
                    className="w-full bg-white/5 border border-white/5 hover:border-white/10 focus:border-primary/50 focus:ring-primary/20 focus:ring-2 focus:bg-white/8 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:outline-none transition-all"
                  />
                </div>
                {formError && <p className="text-rose-400 text-xs font-semibold">{formError}</p>}
                <button
                  data-testid="button-create-group"
                  type="submit"
                  disabled={isPending}
                  className="w-full bg-gradient-to-r from-primary to-cyan-500 hover:from-primary/95 hover:to-cyan-500/95 text-primary-foreground rounded-xl py-3 text-sm font-bold hover:shadow-glow-primary active:scale-98 transition-all disabled:opacity-40"
                >
                  {isPending ? "Creating..." : "Create Group"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleJoin} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest">Invite Code</label>
                  <input
                    data-testid="input-invite-code"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    placeholder="e.g. A1B2C3D4"
                    maxLength={8}
                    className="w-full bg-white/5 border border-white/5 hover:border-white/10 focus:border-primary/50 focus:ring-primary/20 focus:ring-2 focus:bg-white/8 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:outline-none transition-all font-mono tracking-widest text-center uppercase"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest">Your Name</label>
                  <input
                    data-testid="input-member-name"
                    value={memberName}
                    onChange={(e) => setMemberName(e.target.value)}
                    placeholder="e.g. Jordan"
                    maxLength={50}
                    className="w-full bg-white/5 border border-white/5 hover:border-white/10 focus:border-primary/50 focus:ring-primary/20 focus:ring-2 focus:bg-white/8 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:outline-none transition-all"
                  />
                </div>
                {formError && <p className="text-rose-400 text-xs font-semibold">{formError}</p>}
                <button
                  data-testid="button-join-group"
                  type="submit"
                  disabled={isPending}
                  className="w-full bg-gradient-to-r from-primary to-cyan-500 hover:from-primary/95 hover:to-cyan-500/95 text-primary-foreground rounded-xl py-3 text-sm font-bold hover:shadow-glow-primary active:scale-98 transition-all disabled:opacity-40"
                >
                  {isPending ? "Joining..." : "Join Group"}
                </button>
              </form>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Locations are only shared with your group members
        </p>
      </div>
    </div>
  );
}
