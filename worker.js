const COOKIE_NAME = "fiza_admin";
const SESSION_TTL = 60 * 60 * 8;

const PACKAGES = [
  { id: "umrah", name: "Umrah Assistance", description: "Comfortable planning for your sacred journey." },
  { id: "hajj", name: "Hajj Assistance", description: "A carefully guided pilgrimage journey." }
];

const SETTINGS = {
  business_name: "Fiza Enterprises",
  tagline: "Hajj & Umrah Pilgrimage Assistance",
  phone: "9901884387",
  whatsapp: "919901884387",
  email: "travelfizatours@gmail.com",
  location: "Indipump, Hubli, Karnataka, India"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const raw = atob(s);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function makeSession(env, username) {
  const payload = `${username}|${Date.now() + SESSION_TTL * 1000}`;
  const sig = b64url(await hmac(env.SESSION_SECRET, payload));
  return `${b64url(new TextEncoder().encode(payload))}.${sig}`;
}

async function readSession(request, env) {
  const raw = request.headers.get("Cookie") || "";
  const match = raw.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match || !env.SESSION_SECRET) return null;

  try {
    const [p64, sig] = match[1].split(".");
    const payload = new TextDecoder().decode(unb64url(p64));
    const [username, expires] = payload.split("|");
    if (!username || Number(expires) < Date.now()) return null;

    const expected = await hmac(env.SESSION_SECRET, payload);
    const actual = unb64url(sig);
    if (expected.length !== actual.length) return null;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
    return diff === 0 ? username : null;
  } catch {
    return null;
  }
}

function sessionCookie(value) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

async function supabase(env, path, options = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    throw new Error("Supabase is not configured");
  }

  const headers = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options, headers
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!response.ok) {
    console.error("Supabase request failed:", response.status);
    throw new Error("Database request failed");
  }
  return data;
}

function cleanEnquiry(body) {
  const adults = Math.max(1, Number.parseInt(body.adults ?? 1, 10) || 1);
  const children = Math.max(0, Number.parseInt(body.children ?? 0, 10) || 0);
  return {
    interested_in: String(body.interest || body.interested_in || "").slice(0, 40),
    package_text: String(body.packageText || body.package_text || "").slice(0, 120),
    full_name: String(body.name || body.full_name || "").trim().slice(0, 120),
    phone: String(body.phone || "").trim().slice(0, 40),
    city: String(body.city || "").trim().slice(0, 100),
    email: String(body.email || "").trim().slice(0, 160),
    travel_month: String(body.travelMonth || body.travel_month || "").slice(0, 60),
    adults, children,
    message: String(body.message || "").trim().slice(0, 2000)
  };
}

async function handleApi(request, env, url) {
  const method = request.method;
  const path = url.pathname;

  if (path === "/api/login" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const username = String(body.username || "");
    const password = String(body.password || "");

    if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
      return json({ error: "Admin authentication is not configured" }, 500);
    }

    if (username !== env.ADMIN_USERNAME || password !== env.ADMIN_PASSWORD) {
      return json({ error: "Invalid username or password" }, 401);
    }

    const token = await makeSession(env, username);
    return new Response(JSON.stringify({ ok: true, username }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "Set-Cookie": sessionCookie(token)
      }
    });
  }

  if (path === "/api/logout" && method === "POST") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
      }
    });
  }

  if (path === "/api/me" && method === "GET") {
    const username = await readSession(request, env);
    return username ? json({ authenticated: true, username }) : json({ authenticated: false }, 401);
  }

  if (path === "/api/enquiries" && method === "POST") {
    const data = cleanEnquiry(await request.json().catch(() => ({})));
    if (!data.full_name || !data.phone) {
      return json({ error: "Name and phone are required" }, 400);
    }

    try {
      const rows = await supabase(env, "enquiries", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(data)
      });
      return json({ ok: true, enquiry: rows?.[0] || null }, 201);
    } catch {
      return json({ error: "Could not save enquiry. Please try again." }, 503);
    }
  }

  if (path === "/api/packages" && method === "GET") return json(PACKAGES);
  if (path === "/api/settings" && method === "GET") return json(SETTINGS);

  if (path.startsWith("/api/admin/")) {
    const username = await readSession(request, env);
    if (!username) return json({ error: "Not authenticated" }, 401);

    if (path === "/api/admin/dashboard" && method === "GET") {
      try {
        const rows = await supabase(env, "enquiries?select=*&order=created_at.desc&limit=50");
        const all = Array.isArray(rows) ? rows : [];
        return json({
          stats: {
            total: all.length,
            new: all.filter(x => (x.status || "new").toLowerCase() === "new").length,
            hajj: all.filter(x => (x.interested_in || "").toLowerCase() === "hajj").length,
            umrah: all.filter(x => (x.interested_in || "").toLowerCase() === "umrah").length
          },
          enquiries: all
        });
      } catch {
        return json({ error: "Could not load enquiries" }, 503);
      }
    }

    const enquiryMatch = path.match(/^\/api\/admin\/enquiries\/(\d+)$/);
    if (enquiryMatch && method === "PATCH") {
      const id = enquiryMatch[1];
      const body = await request.json().catch(() => ({}));
      const allowed = ["new", "contacted", "follow-up", "confirmed", "completed", "cancelled"];
      const status = String(body.status || "").toLowerCase();
      if (!allowed.includes(status)) return json({ error: "Invalid status" }, 400);

      try {
        const rows = await supabase(env, `enquiries?id=eq.${id}`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ status })
        });
        return json({ ok: true, enquiry: rows?.[0] || null });
      } catch {
        return json({ error: "Could not update enquiry" }, 503);
      }
    }

    if (path === "/api/admin/packages" && method === "GET") return json(PACKAGES);
    if (path === "/api/admin/settings" && method === "GET") return json(SETTINGS);

    return json({ error: "Not found" }, 404);
  }

  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const response = await handleApi(request, env, url);
      if (response) return response;
    }

    // Serve index.html for normal website routes; serve files directly when present.
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;

      if (request.method === "GET" && !url.pathname.includes(".")) {
        return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
      }
    }

    return new Response("Not found", { status: 404 });
  }
};
