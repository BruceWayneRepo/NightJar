// GET /api/drive/status: is the always-connected helper set up?
import { configured, json } from "../_drive.js";

export function GET() {
  return json({ configured: configured() });
}
