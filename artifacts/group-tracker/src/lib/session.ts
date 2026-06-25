export interface GroupSession {
  groupId: string;
  memberId: string;
  token: string;
  memberName: string;
  groupName: string;
  inviteCode: string;
}

const SESSION_KEY = "groupSession";

export function getSession(): GroupSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GroupSession;
  } catch {
    return null;
  }
}

export function saveSession(session: GroupSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}

export function getOrInitializeUserId(): string {
  let userId = localStorage.getItem("findmy_userId");
  if (!userId) {
    userId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem("findmy_userId", userId);
  }
  return userId;
}
