// POST /api/drive/refresh { sealed, idToken }: a new one-hour Drive access key, no popup.
import { body, configured, googleToken, json, unseal, verifyUser } from "../_drive";

export async function POST(req: Request) {
  if (!configured()) return json({ error: "not-configured" }, 503);
  const b = await body(req);
  const uid = await verifyUser(b.idToken);
  if (!uid) return json({ error: "not-signed-in" }, 401);
  const refreshToken = unseal(b.sealed, uid);
  if (!refreshToken) return json({ error: "reconnect" }, 409);
  const t = await googleToken({ refresh_token: refreshToken, grant_type: "refresh_token" });
  if (!t.access_token) return json({ error: t.error === "invalid_grant" ? "reconnect" : t.error ?? "refresh-failed" }, t.error === "invalid_grant" ? 409 : 502);
  return json({ access_token: t.access_token, expires_in: t.expires_in ?? 3600 });
}
