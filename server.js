require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");

const app = express();
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.warn("WARNING: Set SESSION_SECRET to a random value of at least 32 characters.");
}

const db = new Database(path.join(DATA_DIR, "fiza.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('Hajj','Umrah')),
  name TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  description TEXT DEFAULT '',
  price_label TEXT DEFAULT 'Contact us',
  duration TEXT DEFAULT '',
  hotel_makkah TEXT DEFAULT '',
  hotel_madinah TEXT DEFAULT '',
  inclusions TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id INTEGER,
  interest TEXT NOT NULL CHECK(interest IN ('Hajj','Umrah')),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT DEFAULT '',
  city TEXT NOT NULL,
  travel_month TEXT DEFAULT '',
  adults INTEGER NOT NULL DEFAULT 1,
  children INTEGER NOT NULL DEFAULT 0,
  message TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'New' CHECK(status IN ('New','Contacted','Follow-up','Confirmed','Completed','Cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(package_id) REFERENCES packages(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

const settingDefaults = {
  business_name: "Fiza Enterprises",
  tagline: "Hajj & Umrah Pilgrimage Assistance",
  phone: "9901884387",
  whatsapp: "919901884387",
  email: "travelfizatours@gmail.com",
  location: "Indipump, Hubli, Karnataka, India"
};
const insertSetting = db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)");
for (const [k, v] of Object.entries(settingDefaults)) insertSetting.run(k, v);

const username = process.env.ADMIN_USERNAME || "admin";
const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 12) {
  console.warn("No secure admin password supplied. Set ADMIN_PASSWORD before running production.");
} else {
  const hash = bcrypt.hashSync(password, 12);
  const existing = db.prepare("SELECT id FROM admins WHERE username = ?").get(username);
  if (existing) {
    db.prepare("UPDATE admins SET password_hash = ? WHERE username = ?").run(hash, username);
    console.log(`Updated admin password for: ${username}`);
  } else {
    db.prepare("INSERT INTO admins(username,password_hash) VALUES(?,?)").run(username, hash);
    console.log(`Created admin user: ${username}`);
  }
}

if (db.prepare("SELECT COUNT(*) AS n FROM packages").get().n === 0) {
  const seed = db.prepare(`INSERT INTO packages(type,name,subtitle,description,price_label,duration,inclusions,active)
    VALUES(?,?,?,?,?,?,?,1)`);
  seed.run("Hajj", "Hajj Assistance", "A carefully guided pilgrimage journey",
    "Discuss your Hajj requirements with our team and receive personalized assistance.",
    "Contact us", "As per selected package",
    "Visa assistance\\nAccommodation options\\nTransportation assistance\\nPilgrim guidance");
  seed.run("Umrah", "Umrah Assistance", "Comfortable planning for your sacred journey",
    "Tell us your travel requirements and our team will guide you through suitable Umrah options.",
    "Contact us", "Flexible",
    "Visa assistance\\nHotel options\\nTransportation assistance\\nPilgrim guidance");
}

const supabaseUrl = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const supabaseSecretKey = String(process.env.SUPABASE_SECRET_KEY || "").trim();
const supabaseConfigured = /^https:\/\/[^\s/]+\.supabase\.co$/.test(supabaseUrl) && !!supabaseSecretKey;
const supabaseEnquiriesUrl = supabaseConfigured ? `${supabaseUrl}/rest/v1/enquiries` : null;

if (!supabaseConfigured) {
  console.warn("Supabase enquiries storage is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY in the server environment.");
}

async function supabaseFetch(url, options = {}) {
  if (!supabaseConfigured) throw new Error("Supabase is not configured on the server.");
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: supabaseSecretKey,
      Authorization: `Bearer ${supabaseSecretKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const detail = typeof data === "object" && data ? (data.message || data.hint || data.details || data.error) : data;
    throw new Error(`Supabase request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return { response, data };
}

async function supabaseCount(extraParams = "") {
  const separator = extraParams ? `&${extraParams}` : "";
  const { response } = await supabaseFetch(`${supabaseEnquiriesUrl}?select=id&limit=1${separator}`, {
    headers: { Prefer: "count=exact" }
  });
  const range = response.headers.get("content-range") || "";
  const match = range.match(/\/(\d+|\*)$/);
  return match && match[1] !== "*" ? Number(match[1]) : 0;
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: false, limit: "50kb" }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite3", dir: DATA_DIR }),
  secret: process.env.SESSION_SECRET || "development-only-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use(express.static(path.join(__dirname, "public")));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const enquiryLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ error: "Authentication required" });
  next();
}
function clean(v, max = 1000) { return String(v ?? "").trim().slice(0, max); }
function int(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function validPhone(v) { return /^[0-9+()\- .]{7,20}$/.test(v); }

app.get("/api/public/settings", (req, res) => {
  const rows = db.prepare("SELECT key,value FROM settings").all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});
app.get("/api/public/packages", (req, res) => {
  const type = req.query.type === "Hajj" || req.query.type === "Umrah" ? req.query.type : null;
  const sql = type ? "SELECT * FROM packages WHERE active=1 AND type=? ORDER BY id DESC" : "SELECT * FROM packages WHERE active=1 ORDER BY id DESC";
  const rows = type ? db.prepare(sql).all(type) : db.prepare(sql).all();
  res.json(rows);
});

app.post("/api/enquiries", enquiryLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const name = clean(body.name, 120);
    const phone = clean(body.phone, 30);
    const city = clean(body.city, 120);
    const email = clean(body.email, 160);
    const interest = clean(body.interest, 20);
    if (!name || !phone || !city || !["Hajj", "Umrah"].includes(interest)) {
      return res.status(400).json({ error: "Please provide name, WhatsApp/phone, city and Hajj or Umrah interest." });
    }
    if (!validPhone(phone)) return res.status(400).json({ error: "Please enter a valid phone number." });
    if (!supabaseConfigured) return res.status(503).json({ error: "Enquiry service is temporarily unavailable. Please contact us by WhatsApp or phone." });

    const packageId = body.packageId ? int(body.packageId, 1, 2147483647, null) : null;
    const packageRow = packageId ? db.prepare("SELECT id,name FROM packages WHERE id=? AND active=1").get(packageId) : null;
    const packageText = packageRow?.name || clean(body.package || "", 200);

    const payload = {
      interested_in: interest,
      package_text: packageText,
      full_name: name,
      phone,
      city,
      email,
      travel_month: clean(body.travelMonth, 30),
      adults: int(body.adults, 1, 50, 1),
      children: int(body.children, 0, 50, 0),
      message: clean(body.message, 2000),
      status: "New"
    };

    const { data } = await supabaseFetch(`${supabaseEnquiriesUrl}?select=id`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload)
    });
    const id = Array.isArray(data) && data[0] ? data[0].id : null;
    res.status(201).json({ ok: true, id });
  } catch (error) {
    console.error("Supabase enquiry insert error:", error.message);
    res.status(500).json({ error: "We could not save your enquiry. Please try again or contact us by WhatsApp or phone." });
  }
});

app.post("/api/login", loginLimiter, async (req, res) => {
  const username = clean(req.body.username, 100);
  const password = String(req.body.password || "");
  const admin = db.prepare("SELECT * FROM admins WHERE username=?").get(username);
  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  req.session.adminId = admin.id;
  req.session.username = admin.username;
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ error: "Could not create login session" });
    }
    res.json({ ok: true, username: admin.username });
  });
});
app.post("/api/logout", requireAdmin, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/me", (req, res) => res.json({ authenticated: !!req.session.adminId, username: req.session.username || null }));

app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: "Supabase enquiries storage is not configured." });

    const [total, fresh, hajj, umrah, recentResult] = await Promise.all([
      supabaseCount(),
      supabaseCount("status=eq.New"),
      supabaseCount("interested_in=eq.Hajj"),
      supabaseCount("interested_in=eq.Umrah"),
      supabaseFetch(`${supabaseEnquiriesUrl}?select=*&order=created_at.desc&limit=50`)
    ]);

    const recent = Array.isArray(recentResult.data) ? recentResult.data.map(x => ({
      id: x.id,
      name: x.full_name,
      interest: x.interested_in,
      package_name: x.package_text || "",
      phone: x.phone,
      email: x.email || "",
      city: x.city,
      travel_month: x.travel_month || "",
      adults: x.adults ?? 1,
      children: x.children ?? 0,
      message: x.message || "",
      status: x.status || "New",
      created_at: x.created_at
    })) : [];

    res.json({ stats: { total, new: fresh, hajj, umrah }, recent });
  } catch (error) {
    console.error("Supabase dashboard error:", error.message);
    res.status(500).json({ error: "Could not load enquiries from the database." });
  }
});

app.patch("/api/admin/enquiries/:id", requireAdmin, async (req, res) => {
  try {
    if (!supabaseConfigured) return res.status(503).json({ error: "Supabase enquiries storage is not configured." });
    const status = clean(req.body.status, 30);
    if (!["New", "Contacted", "Follow-up", "Confirmed", "Completed", "Cancelled"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const id = int(req.params.id, 1, 2147483647, 0);
    if (!id) return res.status(400).json({ error: "Invalid enquiry ID" });
    const { response } = await supabaseFetch(`${supabaseEnquiriesUrl}?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status })
    });
    res.json({ ok: response.ok });
  } catch (error) {
    console.error("Supabase enquiry status error:", error.message);
    res.status(500).json({ error: "Could not update enquiry status." });
  }
});

app.get("/api/admin/packages", requireAdmin, (req, res) => res.json(db.prepare("SELECT * FROM packages ORDER BY id DESC").all()));
app.post("/api/admin/packages", requireAdmin, (req, res) => {
  const b = req.body || {}, type = clean(b.type, 20), name = clean(b.name, 160);
  if (!["Hajj", "Umrah"].includes(type) || !name) return res.status(400).json({ error: "Package type and name are required." });
  const info = db.prepare(`INSERT INTO packages(type,name,subtitle,description,price_label,duration,hotel_makkah,hotel_madinah,inclusions,image_url,active)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(type, name, clean(b.subtitle, 200), clean(b.description, 2000), clean(b.price_label, 100), clean(b.duration, 100), clean(b.hotel_makkah, 200), clean(b.hotel_madinah, 200), clean(b.inclusions, 2000), clean(b.image_url, 1000), b.active === false ? 0 : 1);
  res.status(201).json({ id: info.lastInsertRowid });
});
app.put("/api/admin/packages/:id", requireAdmin, (req, res) => {
  const b = req.body || {}, id = int(req.params.id, 1, 2147483647, 0);
  const current = db.prepare("SELECT * FROM packages WHERE id=?").get(id);
  if (!current) return res.status(404).json({ error: "Package not found" });
  const type = clean(b.type, 20), name = clean(b.name, 160);
  if (!["Hajj", "Umrah"].includes(type) || !name) return res.status(400).json({ error: "Package type and name are required." });
  db.prepare(`UPDATE packages SET type=?,name=?,subtitle=?,description=?,price_label=?,duration=?,hotel_makkah=?,hotel_madinah=?,inclusions=?,image_url=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(type, name, clean(b.subtitle, 200), clean(b.description, 2000), clean(b.price_label, 100), clean(b.duration, 100), clean(b.hotel_makkah, 200), clean(b.hotel_madinah, 200), clean(b.inclusions, 2000), clean(b.image_url, 1000), b.active === false ? 0 : 1, id);
  res.json({ ok: true });
});
app.delete("/api/admin/packages/:id", requireAdmin, (req, res) => {
  const id = int(req.params.id, 1, 2147483647, 0);
  db.prepare("UPDATE packages SET active=0 WHERE id=?").run(id);
  res.json({ ok: true });
});

app.get("/api/admin/settings", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT key,value FROM settings").all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});
app.put("/api/admin/settings", requireAdmin, (req, res) => {
  const allowed = ["business_name", "tagline", "phone", "whatsapp", "email", "location"];
  const stmt = db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const tx = db.transaction(() => allowed.forEach(k => { if (req.body[k] !== undefined) stmt.run(k, clean(req.body[k], 300)); }));
  tx();
  res.json({ ok: true });
});

app.get("/{*splat}", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`Fiza Enterprises running on port ${PORT}`));
