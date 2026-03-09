// server.js — Backend pro t.m Rental System v4
const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "zm3n-si-toto-na-neco-tajneho-" + Date.now();
const DB_PATH = path.join(__dirname, "data", "rental.db");

if (!fs.existsSync(path.join(__dirname, "data"))) {
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
}

// Auto-setup
if (!fs.existsSync(DB_PATH)) {
  console.log("📦 Databáze neexistuje, vytvářím...");
  require("./setup-db");
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// ── Auto-migrace (přidá nové sloupce/tabulky pokud chybí) ──
function migrate() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  
  // Přidej tabulku categories
  if (!tables.includes("categories")) {
    db.exec(`CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0)`);
    db.exec(`INSERT INTO categories (name, sort_order) VALUES ('Bez kategorie', 0)`);
  }
  
  // Přidej category_id do items
  const itemCols = db.prepare("PRAGMA table_info(items)").all().map(c => c.name);
  if (!itemCols.includes("category_id")) {
    db.exec(`ALTER TABLE items ADD COLUMN category_id INTEGER REFERENCES categories(id)`);
  }
  if (!itemCols.includes("borrowed_at")) {
    db.exec(`ALTER TABLE items ADD COLUMN borrowed_at DATETIME`);
  }
  
  // Přidej note do history
  const histCols = db.prepare("PRAGMA table_info(history)").all().map(c => c.name);
  if (!histCols.includes("note")) {
    db.exec(`ALTER TABLE history ADD COLUMN note TEXT DEFAULT ''`);
  }
  if (!histCols.includes("user_name_cache")) {
    db.exec(`ALTER TABLE history ADD COLUMN user_name_cache TEXT DEFAULT ''`);
    db.exec(`UPDATE history SET user_name_cache = (SELECT name FROM users WHERE users.id = history.user_id) WHERE user_name_cache = '' OR user_name_cache IS NULL`);
  }
  if (!histCols.includes("item_name_cache")) {
    db.exec(`ALTER TABLE history ADD COLUMN item_name_cache TEXT DEFAULT ''`);
    db.exec(`UPDATE history SET item_name_cache = (SELECT name FROM items WHERE items.id = history.item_id) WHERE item_name_cache = '' OR item_name_cache IS NULL`);
  }
}
migrate();

// ── Express ─────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Auth ────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Nepřihlášen" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch (e) { return res.status(401).json({ error: "Neplatný token" }); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Přístup odepřen" });
  next();
}

// ── Login ───────────────────────────────────────────────
app.post("/api/login", (req, res) => {
  const { email, pin } = req.body;
  if (!email || !pin) return res.status(400).json({ error: "Vyplň email a PIN" });
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !bcrypt.compareSync(pin, user.pin_hash)) return res.status(401).json({ error: "Neplatné přihlašovací údaje" });
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// ── Categories ──────────────────────────────────────────
app.get("/api/categories", auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM categories ORDER BY sort_order ASC, name ASC").all());
});

app.post("/api/admin/categories", auth, adminOnly, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Vyplň název kategorie" });
  const existing = db.prepare("SELECT id FROM categories WHERE name = ?").get(name);
  if (existing) return res.status(400).json({ error: "Kategorie již existuje" });
  const maxOrder = db.prepare("SELECT MAX(sort_order) as m FROM categories").get();
  const result = db.prepare("INSERT INTO categories (name, sort_order) VALUES (?, ?)").run(name, (maxOrder.m || 0) + 1);
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.put("/api/admin/categories/:id", auth, adminOnly, (req, res) => {
  const { name, sort_order } = req.body;
  const cat = db.prepare("SELECT * FROM categories WHERE id = ?").get(req.params.id);
  if (!cat) return res.status(404).json({ error: "Kategorie nenalezena" });
  if (name) {
    const dup = db.prepare("SELECT id FROM categories WHERE name = ? AND id != ?").get(name, req.params.id);
    if (dup) return res.status(400).json({ error: "Název kategorie již existuje" });
  }
  db.prepare("UPDATE categories SET name = ?, sort_order = ? WHERE id = ?").run(
    name || cat.name, sort_order !== undefined ? sort_order : cat.sort_order, req.params.id
  );
  res.json({ ok: true });
});

app.delete("/api/admin/categories/:id", auth, adminOnly, (req, res) => {
  const catId = parseInt(req.params.id);
  const items = db.prepare("SELECT COUNT(*) as c FROM items WHERE category_id = ?").get(catId);
  if (items.c > 0) return res.status(400).json({ error: "Kategorie obsahuje položky. Nejdřív je přesuň." });
  db.prepare("DELETE FROM categories WHERE id = ?").run(catId);
  res.json({ ok: true });
});

// Přeřazení kategorií (swap sort_order)
app.post("/api/admin/categories/reorder", auth, adminOnly, (req, res) => {
  const { id, direction } = req.body; // direction: "up" or "down"
  const cats = db.prepare("SELECT * FROM categories ORDER BY sort_order ASC").all();
  const idx = cats.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: "Kategorie nenalezena" });
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= cats.length) return res.json({ ok: true }); // already at edge
  const update = db.prepare("UPDATE categories SET sort_order = ? WHERE id = ?");
  update.run(cats[swapIdx].sort_order, cats[idx].id);
  update.run(cats[idx].sort_order, cats[swapIdx].id);
  res.json({ ok: true });
});

// ── Items ───────────────────────────────────────────────
app.get("/api/items", auth, (req, res) => {
  const items = db.prepare(`
    SELECT items.*, users.name as borrowed_by_name, categories.name as category_name
    FROM items
    LEFT JOIN users ON items.borrowed_by = users.id
    LEFT JOIN categories ON items.category_id = categories.id
  `).all();
  res.json(items);
});

app.get("/api/items/:id", auth, (req, res) => {
  const item = db.prepare(`
    SELECT items.*, users.name as borrowed_by_name, categories.name as category_name
    FROM items LEFT JOIN users ON items.borrowed_by = users.id
    LEFT JOIN categories ON items.category_id = categories.id
    WHERE items.id = ?
  `).get(req.params.id);
  if (!item) return res.status(404).json({ error: "Položka nenalezena" });
  res.json(item);
});

app.post("/api/items/:id/borrow", auth, (req, res) => {
  const { note } = req.body || {};
  const item = db.prepare("SELECT * FROM items WHERE id = ?").get(req.params.id);
  if (!item) return res.status(404).json({ error: "Položka nenalezena" });
  if (item.status === "PUJCENO") return res.status(400).json({ error: "Položka je již půjčena" });
  
  // Ověř že uživatel stále existuje v DB
  const userExists = db.prepare("SELECT id FROM users WHERE id = ?").get(req.user.id);
  if (!userExists) return res.status(401).json({ error: "Tvůj účet byl smazán. Přihlas se znovu." });
  
  try {
    const now = new Date().toISOString();
    db.prepare("UPDATE items SET status = 'PUJCENO', borrowed_by = ?, borrowed_at = ? WHERE id = ?").run(req.user.id, now, req.params.id);
    db.prepare("INSERT INTO history (item_id, user_id, action, note, user_name_cache, item_name_cache) VALUES (?, ?, 'PUJCENO', ?, ?, ?)").run(req.params.id, req.user.id, note || "", req.user.name, item.name);
    res.json({ ok: true, status: "PUJCENO" });
  } catch (e) {
    res.status(500).json({ error: "Chyba při půjčení: " + e.message });
  }
});

app.post("/api/items/:id/return", auth, (req, res) => {
  const { note } = req.body || {};
  const item = db.prepare("SELECT * FROM items WHERE id = ?").get(req.params.id);
  if (!item) return res.status(404).json({ error: "Položka nenalezena" });
  if (item.status !== "PUJCENO") return res.status(400).json({ error: "Položka není půjčena" });
  if (item.borrowed_by !== req.user.id && req.user.role !== "admin") {
    return res.status(403).json({ error: "Nemáš oprávnění vrátit tuto položku" });
  }
  
  const userExists = db.prepare("SELECT id FROM users WHERE id = ?").get(req.user.id);
  if (!userExists) return res.status(401).json({ error: "Tvůj účet byl smazán. Přihlas se znovu." });
  
  try {
    db.prepare("UPDATE items SET status = 'DOSTUPNÉ', borrowed_by = NULL, borrowed_at = NULL WHERE id = ?").run(req.params.id);
    db.prepare("INSERT INTO history (item_id, user_id, action, note, user_name_cache, item_name_cache) VALUES (?, ?, 'VRACENO', ?, ?, ?)").run(req.params.id, req.user.id, note || "", req.user.name, item.name);
    res.json({ ok: true, status: "DOSTUPNÉ" });
  } catch (e) {
    res.status(500).json({ error: "Chyba při vrácení: " + e.message });
  }
});

// ── History (with filtering) ────────────────────────────
app.get("/api/history", auth, (req, res) => {
  const { user_name, item_id } = req.query;
  let where = [];
  let params = [];
  
  if (req.user.role !== "admin") {
    where.push("history.user_id = ?");
    params.push(req.user.id);
  }
  if (user_name) {
    where.push("(users.name LIKE ? OR history.user_name_cache LIKE ?)");
    params.push("%" + user_name + "%", "%" + user_name + "%");
  }
  if (item_id) {
    where.push("history.item_id LIKE ?");
    params.push("%" + item_id + "%");
  }
  
  const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";
  const query = `
    SELECT history.*, 
           COALESCE(items.name, history.item_name_cache, 'Smazaná položka') as item_name, 
           COALESCE(users.name, history.user_name_cache, 'Smazaný uživatel') as user_name
    FROM history
    LEFT JOIN items ON history.item_id = items.id
    LEFT JOIN users ON history.user_id = users.id
    ${whereClause}
    ORDER BY history.timestamp DESC
    LIMIT 200`;
  
  res.json(db.prepare(query).all(...params));
});

// ── History CSV export ──────────────────────────────────
app.get("/api/history/export", auth, adminOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT history.timestamp, 
           COALESCE(users.name, history.user_name_cache, 'Smazaný uživatel') as user_name, 
           COALESCE(users.email, '') as user_email,
           history.item_id, COALESCE(items.name, history.item_name_cache, 'Smazaná položka') as item_name, 
           history.action, history.note
    FROM history
    LEFT JOIN items ON history.item_id = items.id
    LEFT JOIN users ON history.user_id = users.id
    ORDER BY history.timestamp DESC
  `).all();
  
  let csv = "Datum;Uživatel;Email;ID položky;Název položky;Akce;Poznámka\n";
  for (const r of rows) {
    csv += `${r.timestamp};${r.user_name};${r.user_email};${r.item_id};${r.item_name};${r.action === "PUJCENO" ? "Půjčeno" : "Vráceno"};${r.note || ""}\n`;
  }
  
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=historie-zapujcek.csv");
  res.send("\uFEFF" + csv); // BOM pro správné kódování v Excelu
});

// ── Admin: Users ────────────────────────────────────────
app.get("/api/admin/users", auth, adminOnly, (req, res) => {
  res.json(db.prepare("SELECT id, name, email, role FROM users").all());
});

app.post("/api/admin/users", auth, adminOnly, (req, res) => {
  const { name, email, pin, role } = req.body;
  if (!name || !email || !pin) return res.status(400).json({ error: "Vyplň jméno, email a PIN" });
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return res.status(400).json({ error: "Email již existuje" });
  const hash = bcrypt.hashSync(pin, 10);
  const result = db.prepare("INSERT INTO users (name, email, pin_hash, role) VALUES (?, ?, ?, ?)").run(name, email, hash, role || "user");
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.put("/api/admin/users/:id", auth, adminOnly, (req, res) => {
  const { name, email, pin, role } = req.body;
  const userId = parseInt(req.params.id);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(404).json({ error: "Uživatel nenalezen" });
  if (email && email !== user.email) {
    const dup = db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(email, userId);
    if (dup) return res.status(400).json({ error: "Email již používá jiný uživatel" });
  }
  db.prepare("UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?").run(name || user.name, email || user.email, role || user.role, userId);
  if (pin && pin.length >= 4) db.prepare("UPDATE users SET pin_hash = ? WHERE id = ?").run(bcrypt.hashSync(pin, 10), userId);
  res.json({ ok: true });
});

app.delete("/api/admin/users/:id", auth, adminOnly, (req, res) => {
  const userId = parseInt(req.params.id);
  if (userId === req.user.id) return res.status(400).json({ error: "Nemůžeš smazat sám sebe" });
  const borrowed = db.prepare("SELECT COUNT(*) as count FROM items WHERE borrowed_by = ?").get(userId);
  if (borrowed.count > 0) return res.status(400).json({ error: "Uživatel má půjčené položky. Nejdřív je vrať." });
  
  try {
    const user = db.prepare("SELECT name FROM users WHERE id = ?").get(userId);
    if (user) {
      // Ulož jméno do cache v historii (záznamy zůstanou)
      db.prepare("UPDATE history SET user_name_cache = ? WHERE user_id = ?").run(user.name + " (smazán)", userId);
    }
    // Vypni FK kontrolu, smaž uživatele, zapni zpět
    db.pragma("foreign_keys = OFF");
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    db.pragma("foreign_keys = ON");
    res.json({ ok: true });
  } catch (e) {
    db.pragma("foreign_keys = ON");
    res.status(500).json({ error: "Chyba při mazání: " + e.message });
  }
});

// ── Admin: Items ────────────────────────────────────────
app.post("/api/admin/items", auth, adminOnly, (req, res) => {
  const { id, name, category_id } = req.body;
  if (!id || !name) return res.status(400).json({ error: "Vyplň ID a název" });
  const existing = db.prepare("SELECT id FROM items WHERE id = ?").get(id);
  if (existing) return res.status(400).json({ error: "ID již existuje" });
  db.prepare("INSERT INTO items (id, name, category_id) VALUES (?, ?, ?)").run(id, name, category_id || null);
  res.json({ ok: true });
});

app.put("/api/admin/items/:id", auth, adminOnly, (req, res) => {
  const { name, category_id } = req.body;
  const item = db.prepare("SELECT * FROM items WHERE id = ?").get(req.params.id);
  if (!item) return res.status(404).json({ error: "Položka nenalezena" });
  db.prepare("UPDATE items SET name = ?, category_id = ? WHERE id = ?").run(
    name || item.name, category_id !== undefined ? category_id : item.category_id, req.params.id
  );
  res.json({ ok: true });
});

app.delete("/api/admin/items/:id", auth, adminOnly, (req, res) => {
  const item = db.prepare("SELECT * FROM items WHERE id = ?").get(req.params.id);
  if (!item) return res.status(404).json({ error: "Položka nenalezena" });
  if (item.status === "PUJCENO") return res.status(400).json({ error: "Položka je půjčená" });
  
  try {
    // Ulož název do cache v historii (záznamy zůstanou)
    db.prepare("UPDATE history SET item_name_cache = ? WHERE item_id = ?").run(item.name + " (smazána)", req.params.id);
    // Smaž položku s vypnutou FK kontrolou
    db.pragma("foreign_keys = OFF");
    db.prepare("DELETE FROM items WHERE id = ?").run(req.params.id);
    db.pragma("foreign_keys = ON");
    res.json({ ok: true });
  } catch (e) {
    db.pragma("foreign_keys = ON");
    res.status(500).json({ error: "Chyba při mazání: " + e.message });
  }
});

// ── Fallback ────────────────────────────────────────────
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`\n🚀 t.m Rental System v4 běží na portu ${PORT}`);
  console.log(`   http://localhost:${PORT}\n`);
});
