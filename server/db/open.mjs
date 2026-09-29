import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
export function openDatabase() {
  mkdirSync("data", { recursive: true });
  const db = new DatabaseSync(process.env.DB_PATH || "data/portal.sqlite");
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS operations(id INTEGER PRIMARY KEY,external_id TEXT NOT NULL,source TEXT NOT NULL,date TEXT NOT NULL,org TEXT NOT NULL,point TEXT DEFAULT '',counterparty TEXT DEFAULT '',document TEXT NOT NULL,kind TEXT NOT NULL,amount INTEGER NOT NULL,cost INTEGER DEFAULT 0,due TEXT DEFAULT '',article TEXT DEFAULT '',UNIQUE(source,external_id));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,time TEXT,author TEXT,action TEXT,detail TEXT);
CREATE TABLE IF NOT EXISTS periods(month TEXT PRIMARY KEY,closed INTEGER);
CREATE TABLE IF NOT EXISTS plans(id INTEGER PRIMARY KEY,date TEXT,org TEXT,article TEXT,amount INTEGER,direction TEXT);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT,role TEXT,org TEXT,point TEXT,salt TEXT,password TEXT);
CREATE TABLE IF NOT EXISTS budgets(month TEXT,org TEXT,metric TEXT,amount INTEGER,PRIMARY KEY(month,org,metric));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER,expires INTEGER);`);
  return db;
}
