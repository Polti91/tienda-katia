import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// A session is considered "online" if it pinged within this window.
const ACTIVE_WINDOW_MS = 45_000;

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let sessionId: string | null = null;
  try {
    const body = await req.json();
    sessionId = typeof body?.sessionId === "string" ? body.sessionId.slice(0, 64) : null;
  } catch {
    // malformed body, handled below
  }

  if (!sessionId) {
    return new Response(JSON.stringify({ error: "missing sessionId" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const store = getStore("presence");
  const now = Date.now();

  await store.setJSON(sessionId, { ts: now });

  const { blobs } = await store.list();

  let online = 0;
  const stale: string[] = [];

  await Promise.all(
    blobs.map(async (b) => {
      const entry = await store.get(b.key, { type: "json" });
      if (entry && typeof entry.ts === "number" && now - entry.ts <= ACTIVE_WINDOW_MS) {
        online += 1;
      } else {
        stale.push(b.key);
      }
    })
  );

  // Best-effort cleanup of stale sessions; don't block the response on it.
  if (stale.length) {
    Promise.all(stale.map((key) => store.delete(key))).catch(() => {});
  }

  return new Response(JSON.stringify({ online: Math.max(online, 1) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/presence",
};
