// POST /api/drive/exchange { code, redirectUri, idToken }
// One-time: turns Google's consent code into a fresh access key plus a sealed refresh key.
import { body, configured, googleToken, json, seal, verifyUser } from "../_drive";

export async function POST(req: Request) {
  if (!configured()) return json({ error: "not-configured" }, 503);
  const b = await body(req);
  const uid = await verifyUser(b.idToken);
  if (!uid) return json({ error: "not-signed-in" }, 401);
  if (typeof b.code !== "string" || typeof b.redirectUri !== "string") return json({ error: "bad-request" }, 400);
  const t = await googleToken({ code: b.code, redirect_uri: b.redirectUri, grant_type: "authorization_code" });
  if (!t.access_token) return json({ error: t.error ?? "exchange-failed", detail: t.error_description }, 400);
  if (!t.refresh_token) return json({ error: "no-refresh-token", access_token: t.access_token, expires_in: t.expires_in ?? 3600 }, 200);
  return json({ access_token: t.access_token, expires_in: t.expires_in ?? 3600, sealed: seal(t.refresh_token, uid) });
}
