import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { newConversation } from "../dist/conversation.mjs";
export class Store {
  constructor(path) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions(sender TEXT PRIMARY KEY,state TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox(sid TEXT PRIMARY KEY,sender TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,sender TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,sender TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',provider_sid TEXT,delivery_status TEXT,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence(token TEXT PRIMARY KEY,sender TEXT NOT NULL,image TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS inbox_pending ON inbox(state,created_at);
      CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(state,created_at);
      CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(state,created_at);`);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  get(sender) {
    const row = this.db
      .prepare("SELECT state FROM sessions WHERE sender=?")
      .get(sender);
    return row ? JSON.parse(row.state) : newConversation();
  }
  put(sender, state) {
    this.db
      .prepare(
        "INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(sender) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at",
      )
      .run(sender, JSON.stringify(state), Date.now());
  }
  insertInbound(sid, sender, body) {
    return (
      this.db
        .prepare(
          "INSERT OR IGNORE INTO inbox(sid,sender,body,created_at) VALUES(?,?,?,?)",
        )
        .run(sid, sender, body, Date.now()).changes > 0
    );
  }
  hasInbound(sid) {
    return !!this.db.prepare("SELECT 1 FROM inbox WHERE sid=?").get(sid);
  }
  receive(sid, sender, body) {
    return this.transaction(() => {
      if (!this.insertInbound(sid, sender, body)) return false;
      if (/^(stop|unsubscribe|end|quit)$/i.test(body.trim())) {
        const state = this.get(sender);
        state.stopped = true;
        state.revision++;
        state.phase = "gathering";
        this.put(sender, state);
        this.cancel(sender);
        this.db
          .prepare(
            "UPDATE inbox SET state='ignored' WHERE sender=? AND state='pending'",
          )
          .run(sender);
      }
      return true;
    });
  }
  nextInbound() {
    return this.db
      .prepare(
        "SELECT * FROM inbox WHERE state='pending' ORDER BY created_at,rowid LIMIT 1",
      )
      .get();
  }
  inboundDone(sid, state = "done") {
    this.db.prepare("UPDATE inbox SET state=? WHERE sid=?").run(state, sid);
  }
  enqueue(id, sender, body) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO outbox(id,sender,body,created_at) VALUES(?,?,?,?)",
      )
      .run(id, sender, body.slice(0, 1500), Date.now());
  }
  cancel(sender) {
    this.db
      .prepare(
        "UPDATE jobs SET state='cancelled' WHERE sender=? AND state IN ('pending','running')",
      )
      .run(sender);
    this.db
      .prepare(
        "UPDATE outbox SET state='cancelled' WHERE sender=? AND state='pending'",
      )
      .run(sender);
  }
  applyTurn(row, expectedRevision, plan) {
    return this.transaction(() => {
      const current = this.get(row.sender);
      if (current.revision !== expectedRevision) {
        this.inboundDone(row.sid, "superseded");
        return false;
      }
      if (plan.cancel) this.cancel(row.sender);
      this.put(row.sender, plan.state);
      plan.replies.forEach((text, i) =>
        this.enqueue(`${row.sid}:${i}`, row.sender, text),
      );
      if (plan.job)
        this.db
          .prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?)")
          .run(
            randomUUID(),
            row.sender,
            plan.job.revision,
            JSON.stringify(plan.job),
            "pending",
            Date.now(),
          );
      this.inboundDone(row.sid);
      return true;
    });
  }
  claimJob() {
    return this.transaction(() => {
      if (
        this.db
          .prepare("SELECT 1 FROM jobs WHERE state='running' LIMIT 1")
          .get()
      )
        return null;
      const job = this.db
        .prepare(
          "SELECT * FROM jobs WHERE state='pending' ORDER BY created_at,rowid LIMIT 1",
        )
        .get();
      if (!job) return null;
      const state = this.get(job.sender);
      if (state.stopped || state.revision !== job.revision) {
        this.db
          .prepare("UPDATE jobs SET state='cancelled' WHERE id=?")
          .run(job.id);
        return null;
      }
      this.db.prepare("UPDATE jobs SET state='running' WHERE id=?").run(job.id);
      return { ...job, payload: JSON.parse(job.payload) };
    });
  }
  activeJob(id) {
    return this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
  }
  completeJob(job, plan) {
    return this.transaction(() => {
      if (this.activeJob(job.id)?.state !== "running") return false;
      const current = this.get(job.sender);
      if (!plan || current.stopped || current.revision !== job.revision) {
        this.db
          .prepare("UPDATE jobs SET state='cancelled' WHERE id=?")
          .run(job.id);
        return false;
      }
      this.put(job.sender, plan.state);
      plan.replies.forEach((text, i) =>
        this.enqueue(`${job.id}:${i}`, job.sender, text),
      );
      this.db.prepare("UPDATE jobs SET state='done' WHERE id=?").run(job.id);
      return true;
    });
  }
  failJob(job) {
    return this.transaction(() => {
      if (this.activeJob(job.id)?.state !== "running") return;
      this.db.prepare("UPDATE jobs SET state='failed' WHERE id=?").run(job.id);
      const state = this.get(job.sender);
      if (state.revision === job.revision && !state.stopped) {
        state.phase = "ready";
        this.put(job.sender, state);
        this.enqueue(
          job.id + ":error",
          job.sender,
          "I could not complete the phone check. No result is confirmed. Check the phone before replying REFRESH.",
        );
      }
    });
  }
  claimOutbound() {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT * FROM outbox WHERE state='pending' ORDER BY created_at,rowid LIMIT 1",
        )
        .get();
      if (!row) return null;
      if (this.get(row.sender).stopped) {
        this.db
          .prepare("UPDATE outbox SET state='cancelled' WHERE id=?")
          .run(row.id);
        return null;
      }
      this.db
        .prepare("UPDATE outbox SET state='sending' WHERE id=?")
        .run(row.id);
      return row;
    });
  }
  sent(id, sid) {
    this.db
      .prepare("UPDATE outbox SET state='sent',provider_sid=? WHERE id=?")
      .run(sid, id);
  }
  uncertain(id) {
    this.db.prepare("UPDATE outbox SET state='uncertain' WHERE id=?").run(id);
  }
  delivery(sid, status) {
    this.db
      .prepare("UPDATE outbox SET delivery_status=? WHERE provider_sid=?")
      .run(status, sid);
  }
  evidence(sender, image) {
    const token = randomBytes(24).toString("hex");
    this.db
      .prepare("INSERT INTO evidence VALUES(?,?,?,?)")
      .run(token, sender, image, Date.now() + 900000);
    return token;
  }
  readEvidence(token) {
    const row = this.db
      .prepare("SELECT image FROM evidence WHERE token=? AND expires_at>?")
      .get(token, Date.now());
    return row?.image;
  }
  recentCount(sender) {
    return this.db
      .prepare(
        "SELECT count(*) AS n FROM inbox WHERE sender=? AND created_at>?",
      )
      .get(sender, Date.now() - 60000).n;
  }
  prune() {
    const now = Date.now();
    this.db.prepare("DELETE FROM evidence WHERE expires_at<?").run(now);
    for (const table of ["inbox", "outbox", "jobs"])
      this.db
        .prepare(
          `DELETE FROM ${table} WHERE created_at<? AND state NOT IN ('pending','running','sending')`,
        )
        .run(now - 86400000);
    this.db
      .prepare(
        "DELETE FROM sessions WHERE updated_at<? AND sender NOT IN (SELECT sender FROM jobs WHERE state IN ('pending','running'))",
      )
      .run(now - 7 * 86400000);
  }
  recover() {
    return this.transaction(() => {
      // A network send may have succeeded before a crash. Never blindly resend it.
      this.db.exec("UPDATE outbox SET state='uncertain' WHERE state='sending'");
      const jobs = this.db
        .prepare("SELECT * FROM jobs WHERE state='running'")
        .all();
      for (const job of jobs) {
        this.db
          .prepare("UPDATE jobs SET state='interrupted' WHERE id=?")
          .run(job.id);
        const state = this.get(job.sender);
        if (state.revision === job.revision && !state.stopped) {
          state.phase = "ready";
          this.put(job.sender, state);
          this.enqueue(
            job.id + ":interrupted",
            job.sender,
            "The phone check was interrupted. I will not repeat phone actions automatically. Check the apps, then reply REFRESH to try again.",
          );
        }
      }
    });
  }
  close() {
    this.db.close();
  }
}
