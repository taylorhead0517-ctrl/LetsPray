const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const cookieName = "letspray_admin";
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });
const sameOrigin = request => request.headers.get("Origin") === new URL(request.url).origin;
const readBody = request => request.json().catch(() => ({}));
const getSettings = async env => JSON.parse(await env.INTERCEDE_KV.get("settings") || "null");

async function sign(password, until) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(until)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function authed(request, password) {
  if (!password) return false;
  const cookie = request.headers.get("Cookie")?.split("; ").find(c => c.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
  if (!cookie) return false;
  const [until, mac] = cookie.split(".");
  if (!until || !mac || !Number.isFinite(Number(until)) || Number(until) < Date.now()) return false;
  const expected = await sign(password, until);
  if (mac.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
async function makeCookie(password) {
  const until = String(Date.now() + 86400000);
  return `${cookieName}=${until}.${await sign(password, until)}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=86400`;
}

export async function onRequest({ request, env }) {
  if (!env.INTERCEDE_KV) return json({ error: "KV namespace not bound" }, 500);
  const key = new URL(request.url).searchParams.get("key") || "people";
  const settings = await getSettings(env);

  if (key === "auth") {
    if (request.method === "GET") return json({ authenticated: await authed(request, settings?.password) });
    if (!sameOrigin(request)) return json({ error: "Forbidden" }, 403);
    if (request.method === "DELETE") return json({ ok: true }, 200, { "Set-Cookie": `${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0` });
    if (request.method === "POST") {
      const { password } = await readBody(request);
      if (!settings?.password || typeof password !== "string" || password !== settings.password) return json({ error: "Incorrect password" }, 401);
      return json({ authenticated: true }, 200, { "Set-Cookie": await makeCookie(password) });
    }
    if (request.method === "PUT") {
      if (!(await authed(request, settings?.password))) return json({ error: "Admin required" }, 403);
      const { newPassword } = await readBody(request);
      if (typeof newPassword !== "string" || newPassword.length < 12) return json({ error: "Use at least 12 characters" }, 400);
      await env.INTERCEDE_KV.put("settings", JSON.stringify({ ...settings, password: newPassword }));
      return json({ ok: true }, 200, { "Set-Cookie": await makeCookie(newPassword) });
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (key === "settings") {
    if (request.method === "GET") return json(settings ? { name: settings.name, sub: settings.sub } : null);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!sameOrigin(request) || settings) return json({ error: "Already configured or forbidden" }, 403);
    const incoming = await readBody(request);
    if (typeof incoming.name !== "string" || !incoming.name.trim() || typeof incoming.password !== "string" || incoming.password.length < 12) return json({ error: "Invalid setup" }, 400);
    await env.INTERCEDE_KV.put("settings", JSON.stringify({ name: incoming.name.trim(), sub: String(incoming.sub || ""), password: incoming.password }));
    return json({ ok: true });
  }

  if (key !== "people") return json({ error: "Unknown key" }, 404);
  if (request.method === "GET") return json(JSON.parse(await env.INTERCEDE_KV.get("people") || "[]"));
  if (!sameOrigin(request)) return json({ error: "Forbidden" }, 403);

  if (request.method === "PATCH") {
    const { id, undo } = await readBody(request);
    if (typeof id !== "string" || id.length > 100 || (undo !== undefined && typeof undo !== "boolean")) return json({ error: "Invalid person" }, 400);
    const people = JSON.parse(await env.INTERCEDE_KV.get("people") || "[]");
    const person = people.find(p => p.id === id && p.active !== false);
    if (!person) return json({ error: "Person not found" }, 404);
    const now = Date.now();
    if (undo) person.prayedAt = null;
    else {
      const d = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/New_York" }));
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const week = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
      person.weekPrayCount = person.prayedWeekDate === week ? (person.weekPrayCount || 1) + 1 : 1;
      person.prayedWeekDate = week;
      person.prayedAt = now;
      person.prayCount = (person.prayCount || 0) + 1;
    }
    person.updatedAt = now;
    await env.INTERCEDE_KV.put("people", JSON.stringify(people));
    return json(person);
  }

  if (request.method === "POST") {
    if (!(await authed(request, settings?.password))) return json({ error: "Admin required" }, 403);
    const body = await readBody(request);
    const incoming = Array.isArray(body) ? body : body.data;
    if (!Array.isArray(incoming) || !incoming.length) return json({ error: "Roster must not be empty" }, 400);
    if (!Array.isArray(body) && body.force === true) {
      await env.INTERCEDE_KV.put("people", JSON.stringify(incoming));
      return json({ ok: true, count: incoming.length });
    }
    const old = JSON.parse(await env.INTERCEDE_KV.get("people") || "[]");
    const prior = new Map(old.map(p => [p.id, p]));
    const ids = new Set(incoming.map(p => p.id));
    const merged = incoming.map(p => (p.updatedAt || 0) >= (prior.get(p.id)?.updatedAt || 0) ? p : prior.get(p.id));
    for (const p of old) if (!ids.has(p.id)) merged.push(p);
    await env.INTERCEDE_KV.put("people", JSON.stringify(merged));
    return json({ ok: true, count: merged.length });
  }
  return json({ error: "Method not allowed" }, 405);
}  }

  // People endpoint (default)
  if (request.method === "GET") {
    const data = await env.INTERCEDE_KV.get("people");
    return new Response(data || "[]", { headers });
  }

  if (request.method === "POST") {
    const body = await request.text();
    let incoming, force;
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) {
        incoming = parsed;
        force = false;
      } else {
        incoming = parsed.data;
        force = parsed.force === true;
      }
      if (!Array.isArray(incoming)) throw new Error("not array");
    } catch (_e) {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
    }

    if (incoming.length === 0) {
      return new Response(JSON.stringify({ error: "Refusing to store empty data" }), { status: 400, headers });
    }

    if (force) {
      await env.INTERCEDE_KV.put("people", JSON.stringify(incoming));
      return new Response(JSON.stringify({ ok: true, count: incoming.length, forced: true }), { headers });
    }

    let stored = [];
    try {
      const raw = await env.INTERCEDE_KV.get("people");
      if (raw) stored = JSON.parse(raw);
      if (!Array.isArray(stored)) stored = [];
    } catch (_e) { stored = []; }

    const storedMap = Object.fromEntries(stored.map(p => [p.id, p]));
    const incomingIds = new Set(incoming.map(p => p.id));

    const merged = incoming.map(p => {
      const s = storedMap[p.id];
      if (!s) return p;
      return (p.updatedAt || 0) >= (s.updatedAt || 0) ? p : s;
    });

    for (const s of stored) {
      if (!incomingIds.has(s.id)) merged.push(s);
    }

    await env.INTERCEDE_KV.put("people", JSON.stringify(merged));
    return new Response(JSON.stringify({ ok: true, count: merged.length }), { headers });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
}
