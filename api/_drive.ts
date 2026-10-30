// Shared code for the Google Drive helper (Vercel functions). Files starting with "_" are not endpoints.
// The helper keeps your Drive connected: it trades a one-time "offline" consent for a long-lived
// refresh key, locks that key with encryption tied to your account, and later swaps it for fresh
// one-hour access keys. The client secret and the unlocked refresh key never leave the server.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyA89Ovi9vr58yIq-Nh2hkSTNAXFdhN_Fqw";
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

export const configured = () => Boolean(CLIENT_ID && CLIENT_SECRET);

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** Check the Firebase sign-in token and return the user id. */
export async function verifyUser(idToken: unknown): Promise<string | null> {
  if (typeof idToken !== "string" || idToken.length < 20) return null;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { users?: { localId: string }[] };
  return data.users?.[0]?.localId ?? null;
}

function key() {
  return createHash("sha256").update(`nightjar-drive-v1:${CLIENT_SECRET}:${process.env.DRIVE_TOKEN_KEY ?? ""}`).digest();
}

/** Lock the refresh key so only this server, for this user, can use it. */
export function seal(refreshToken: string, uid: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from(uid));
  const enc = Buffer.concat([c.update(refreshToken, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}

export function unseal(sealed: unknown, uid: string): string | null {
  if (typeof sealed !== "string") return null;
  try {
    const buf = Buffer.from(sealed, "base64url");
    const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
    d.setAAD(Buffer.from(uid));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

type TokenResponse = { access_token?: string; expires_in?: number; refresh_token?: string; error?: string; error_description?: string };

export async function googleToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  return (await res.json()) as TokenResponse;
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
