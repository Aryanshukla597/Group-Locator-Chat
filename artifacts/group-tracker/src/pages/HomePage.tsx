import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useCreateGroup, useJoinGroup } from "@workspace/api-client-react";
import { saveSession } from "@/lib/session";
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
  const [tab, setTab] = useState<"create" | "join">("create");
  const [groupName, setGroupName] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [memberName, setMemberName] = useState("");
  const [formError, setFormError] = useState("");

  const createGroup = useCreateGroup();
  const joinGroup = useJoinGroup();

  // Check URL for invite code
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get("join");
    if (joinCode) {
      setTab("join");
      setInviteCode(joinCode);
    }
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!groupName.trim() || !creatorName.trim()) {
      setFormError("Please fill in all fields.");
      return;
    }
    createGroup.mutate(
      { data: { name: groupName.trim(), creatorName: creatorName.trim() } },
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
    joinGroup.mutate(
      { data: { inviteCode: inviteCode.trim().toUpperCase(), memberName: memberName.trim() } },
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
        onError: () => setFormError("Invalid invite code. Please check and try again."),
      }
    );
  };

  const isPending = createGroup.isPending || joinGroup.isPending;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      {/* Background grid */}
      <div className="fixed inset-0 opacity-5 pointer-events-none"
        style={{ backgroundImage: "linear-gradient(hsl(var(--border)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)", backgroundSize: "40px 40px" }}
      />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
            <MapPin className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">FindMy Group</h1>
          <p className="text-muted-foreground mt-2 text-sm">Real-time location sharing for your group</p>
        </div>

        {/* Feature badges */}
        <div className="flex gap-2 justify-center mb-8 flex-wrap">
          {[
            { icon: MapPin, label: "Live Maps" },
            { icon: Shield, label: "Secure" },
            { icon: Zap, label: "Real-time" },
            { icon: AlertTriangle, label: "SOS Alerts" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card border border-border text-xs text-muted-foreground">
              <Icon className="w-3 h-3 text-primary" />
              {label}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl shadow-xl overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-border">
            {(["create", "join"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setFormError(""); }}
                data-testid={`tab-${t}`}
                className={cn(
                  "flex-1 py-3.5 text-sm font-semibold transition-colors",
                  tab === t
                    ? "text-primary border-b-2 border-primary bg-primary/5"
                    : "text-muted-foreground hover:text-foreground"
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
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">Group Name</label>
                  <input
                    data-testid="input-group-name"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="e.g. Mountain Hike Crew"
                    maxLength={100}
                    className="w-full bg-background border border-input rounded-lg px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">Your Name</label>
                  <input
                    data-testid="input-creator-name"
                    value={creatorName}
                    onChange={(e) => setCreatorName(e.target.value)}
                    placeholder="e.g. Alex"
                    maxLength={50}
                    className="w-full bg-background border border-input rounded-lg px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                  />
                </div>
                {formError && <p className="text-destructive text-xs">{formError}</p>}
                <button
                  data-testid="button-create-group"
                  type="submit"
                  disabled={isPending}
                  className="w-full bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {isPending ? "Creating..." : "Create Group"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleJoin} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">Invite Code</label>
                  <input
                    data-testid="input-invite-code"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    placeholder="e.g. A1B2C3D4"
                    maxLength={8}
                    className="w-full bg-background border border-input rounded-lg px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors font-mono tracking-widest"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">Your Name</label>
                  <input
                    data-testid="input-member-name"
                    value={memberName}
                    onChange={(e) => setMemberName(e.target.value)}
                    placeholder="e.g. Jordan"
                    maxLength={50}
                    className="w-full bg-background border border-input rounded-lg px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                  />
                </div>
                {formError && <p className="text-destructive text-xs">{formError}</p>}
                <button
                  data-testid="button-join-group"
                  type="submit"
                  disabled={isPending}
                  className="w-full bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {isPending ? "Joining..." : "Join Group"}
                </button>
              </form>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Locations are only shared with your group members
        </p>
      </div>
    </div>
  );
}
