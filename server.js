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
for (const [k,v] of Object.entries(settingDefaults)) insertSetting.run(k,v);

if (!db.prepare("SELECT id FROM admins LIMIT 1").get()) {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    console.warn("No secure admin password supplied. Set ADMIN_PASSWORD before running production.");
  } else {
    const hash = bcrypt.hashSync(password, 12);
    db.prepare("INSERT INTO admins(username,password_hash) VALUES(?,?)").run(username, hash);
    console.log(`Created admin user: ${username}`);
  }
}

if (db.prepare("SELECT COUNT(*) AS n FROM packages").get().n === 0) {
  const seed = db.prepare(`INSERT INTO packages(type,name,subtitle,description,price_label,duration,inclusions,active)
    VALUES(?,?,?,?,?,?,?,1)`);
  seed.run("Hajj","Hajj Assistance","A carefully guided pilgrimage journey",
    "Discuss your Hajj requirements with our team and receive personalized assistance.",
    "Contact us","As per selected package",
    "Visa assistance\\nAccommodation options\\nTransportation assistance\\nPilgrim guidance");
  seed.run("Umrah","Umrah Assistance","Comfortable planning for your sacred journey",
    "Tell us your travel requirements and our team will guide you through suitable Umrah options.",
    "Contact us","Flexible",
    "Visa assistance\\nHotel options\\nTransportation assistance\\nPilgrim guidance");
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
  store: new SQLiteStore({ db: "sessions.sqlite", dir: DATA_DIR }),
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

const loginLimiter = rateLimit({ windowMs: 15*60*1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const enquiryLimiter = rateLimit({ windowMs: 10*60*1000, limit: 20, standardHeaders: true, legacyHeaders: false });

function requireAdmin(req,res,next) {
  if (!req.session.adminId) return res.status(401).json({error:"Authentication required"});
  next();
}
function clean(v, max=1000) { return String(v ?? "").trim().slice(0,max); }
function int(v, min, max, fallback) {
  const n = Number.parseInt(v,10);
  return Number.isFinite(n) ? Math.min(max,Math.max(min,n)) : fallback;
}
function validPhone(v) { return /^[0-9+()\- .]{7,20}$/.test(v); }

app.get("/api/public/settings", (req,res) => {
  const rows = db.prepare("SELECT key,value FROM settings").all();
  res.json(Object.fromEntries(rows.map(r=>[r.key,r.value])));
});
app.get("/api/public/packages", (req,res) => {
  const type = req.query.type === "Hajj" || req.query.type === "Umrah" ? req.query.type : null;
  const sql = type ? "SELECT * FROM packages WHERE active=1 AND type=? ORDER BY id DESC" : "SELECT * FROM packages WHERE active=1 ORDER BY id DESC";
  const rows = type ? db.prepare(sql).all(type) : db.prepare(sql).all();
  res.json(rows);
});

app.post("/api/enquiries", enquiryLimiter, (req,res) => {
  const body = req.body || {};
  const name = clean(body.name,120), phone = clean(body.phone,30), city = clean(body.city,120);
  const email = clean(body.email,160), interest = clean(body.interest,20);
  if (!name || !phone || !city || !["Hajj","Umrah"].includes(interest))
    return res.status(400).json({error:"Please provide name, WhatsApp/phone, city and Hajj or Umrah interest."});
  if (!validPhone(phone)) return res.status(400).json({error:"Please enter a valid phone number."});
  const packageId = body.packageId ? int(body.packageId,1,2147483647,null) : null;
  const packageExists = packageId ? db.prepare("SELECT id FROM packages WHERE id=? AND active=1").get(packageId) : null;
  const info = db.prepare(`INSERT INTO enquiries(package_id,interest,name,phone,email,city,travel_month,adults,children,message)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      packageExists?.id || null, interest, name, phone, email, city, clean(body.travelMonth,30),
      int(body.adults,1,50,1), int(body.children,0,50,0), clean(body.message,2000)
  );
  res.status(201).json({ok:true,id:info.lastInsertRowid});
});

app.post("/api/login", loginLimiter, async (req,res) => {
  const username = clean(req.body.username,100), password = String(req.body.password || "");
  const admin = db.prepare("SELECT * FROM admins WHERE username=?").get(username);
  if (!admin || !(await bcrypt.compare(password, admin.password_hash)))
    return res.status(401).json({error:"Invalid username or password"});
  req.session.adminId = admin.id;
  req.session.username = admin.username;
  res.json({ok:true,username:admin.username});
});
app.post("/api/logout", requireAdmin, (req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me", (req,res)=>res.json({authenticated:!!req.session.adminId,username:req.session.username||null}));

app.get("/api/admin/dashboard", requireAdmin, (req,res) => {
  const total = db.prepare("SELECT COUNT(*) n FROM enquiries").get().n;
  const fresh = db.prepare("SELECT COUNT(*) n FROM enquiries WHERE status='New'").get().n;
  const hajj = db.prepare("SELECT COUNT(*) n FROM enquiries WHERE interest='Hajj'").get().n;
  const umrah = db.prepare("SELECT COUNT(*) n FROM enquiries WHERE interest='Umrah'").get().n;
  const recent = db.prepare(`SELECT e.*, p.name package_name FROM enquiries e LEFT JOIN packages p ON p.id=e.package_id ORDER BY e.id DESC LIMIT 50`).all();
  res.json({stats:{total,new:fresh,hajj,umrah},recent});
});

app.patch("/api/admin/enquiries/:id", requireAdmin, (req,res) => {
  const status = clean(req.body.status,30);
  if (!["New","Contacted","Follow-up","Confirmed","Completed","Cancelled"].includes(status))
    return res.status(400).json({error:"Invalid status"});
  const result = db.prepare("UPDATE enquiries SET status=? WHERE id=?").run(status,int(req.params.id,1,2147483647,0));
  res.json({ok:result.changes===1});
});

app.get("/api/admin/packages", requireAdmin, (req,res)=>res.json(db.prepare("SELECT * FROM packages ORDER BY id DESC").all()));
app.post("/api/admin/packages", requireAdmin, (req,res) => {
  const b=req.body||{}, type=clean(b.type,20), name=clean(b.name,160);
  if(!["Hajj","Umrah"].includes(type)||!name) return res.status(400).json({error:"Package type and name are required."});
  const info=db.prepare(`INSERT INTO packages(type,name,subtitle,description,price_label,duration,hotel_makkah,hotel_madinah,inclusions,image_url,active)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(type,name,clean(b.subtitle,200),clean(b.description,2000),clean(b.price_label,100),clean(b.duration,100),clean(b.hotel_makkah,200),clean(b.hotel_madinah,200),clean(b.inclusions,2000),clean(b.image_url,1000),b.active===false?0:1);
  res.status(201).json({id:info.lastInsertRowid});
});
app.put("/api/admin/packages/:id", requireAdmin, (req,res) => {
  const b=req.body||{}, id=int(req.params.id,1,2147483647,0);
  const current=db.prepare("SELECT * FROM packages WHERE id=?").get(id);
  if(!current) return res.status(404).json({error:"Package not found"});
  const type=clean(b.type,20), name=clean(b.name,160);
  if(!["Hajj","Umrah"].includes(type)||!name) return res.status(400).json({error:"Package type and name are required."});
  db.prepare(`UPDATE packages SET type=?,name=?,subtitle=?,description=?,price_label=?,duration=?,hotel_makkah=?,hotel_madinah=?,inclusions=?,image_url=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(type,name,clean(b.subtitle,200),clean(b.description,2000),clean(b.price_label,100),clean(b.duration,100),clean(b.hotel_makkah,200),clean(b.hotel_madinah,200),clean(b.inclusions,2000),clean(b.image_url,1000),b.active===false?0:1,id);
  res.json({ok:true});
});
app.delete("/api/admin/packages/:id", requireAdmin, (req,res) => {
  const id=int(req.params.id,1,2147483647,0);
  db.prepare("UPDATE packages SET active=0 WHERE id=?").run(id);
  res.json({ok:true});
});

app.get("/api/admin/settings", requireAdmin, (req,res)=>{
  const rows=db.prepare("SELECT key,value FROM settings").all();
  res.json(Object.fromEntries(rows.map(r=>[r.key,r.value])));
});
app.put("/api/admin/settings", requireAdmin, (req,res)=>{
  const allowed=["business_name","tagline","phone","whatsapp","email","location"];
  const stmt=db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const tx=db.transaction(()=>allowed.forEach(k=>{if(req.body[k]!==undefined) stmt.run(k,clean(req.body[k],300));}));
  tx(); res.json({ok:true});
});

app.get("/{*splat}", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`Fiza Enterprises running on http://localhost:${PORT}`));
