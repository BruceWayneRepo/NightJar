// GET /api/drive/status: is the always-connected helper set up?
import { configured, json } from "../_drive";

export function GET() {
  return json({ configured: configured() });
}
