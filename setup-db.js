// setup-db.js — Vytvoří databázi a vloží výchozí data
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "data", "rental.db");
if (!fs.existsSync(path.join(__dirname, "data"))) {
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    pin_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user'
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    status TEXT NOT NULL DEFAULT 'DOSTUPNÉ',
    borrowed_by INTEGER REFERENCES users(id),
    borrowed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL REFERENCES items(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    note TEXT DEFAULT '',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Výchozí uživatelé
const insertUser = db.prepare("INSERT OR IGNORE INTO users (name, email, pin_hash, role) VALUES (?, ?, ?, ?)");
[
  { name: "Admin", email: "admin@firma.cz", pin: "1234", role: "admin" },
  { name: "Jan Novák", email: "jan@firma.cz", pin: "0000", role: "user" },
  { name: "Petra Kovářová", email: "petra@firma.cz", pin: "1111", role: "user" },
].forEach(u => insertUser.run(u.name, u.email, bcrypt.hashSync(u.pin, 10), u.role));

// Výchozí kategorie
const insertCat = db.prepare("INSERT OR IGNORE INTO categories (name, sort_order) VALUES (?, ?)");
const cats = [
  { name: "Notebooky", order: 1 },
  { name: "Foto & Video", order: 2 },
  { name: "Audio", order: 3 },
  { name: "Tablety", order: 4 },
  { name: "Drony", order: 5 },
];
cats.forEach(c => insertCat.run(c.name, c.order));

// Načti ID kategorií
const getCatId = db.prepare("SELECT id FROM categories WHERE name = ?");

// Výchozí položky
const insertItem = db.prepare("INSERT OR IGNORE INTO items (id, name, category_id) VALUES (?, ?, ?)");
[
  { id: "ITEM-001", name: 'MacBook Pro 14"', cat: "Notebooky" },
  { id: "ITEM-002", name: "Canon EOS R6", cat: "Foto & Video" },
  { id: "ITEM-003", name: "DJI Mavic 3", cat: "Drony" },
  { id: "ITEM-004", name: 'iPad Pro 12.9"', cat: "Tablety" },
  { id: "ITEM-005", name: "Sony WH-1000XM5", cat: "Audio" },
].forEach(i => {
  const cat = getCatId.get(i.cat);
  insertItem.run(i.id, i.name, cat ? cat.id : null);
});

console.log("✅ Databáze vytvořena: " + DB_PATH);
console.log("✅ Kategorie: " + cats.length);
console.log("✅ Uživatelé: admin@firma.cz (1234), jan@firma.cz (0000), petra@firma.cz (1111)");
db.close();
