import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../sms/store.mjs";
import { newConversation, reduceConversation } from "../dist/conversation.mjs";
const sender = "+15550000001";
test("incoming message IDs and outgoing response IDs are idempotent", () => {
  const s = new Store(":memory:");
  try {
    assert.equal(s.receive("one", sender, "help"), true);
    assert.equal(s.receive("one", sender, "help"), false);
    const row = s.nextInbound(),
      plan = reduceConversation(s.get(sender), { intent: "help" });
    s.applyTurn(row, 0, plan);
    s.applyTurn(row, 0, plan);
    assert.equal(s.db.prepare("SELECT count(*) AS n FROM outbox").get().n, 1);
  } finally {
    s.close();
  }
});
test("sessions survive restart and do not leak between senders", () => {
  const dir = mkdtempSync(join(tmpdir(), "fareplay-sms-")),
    path = join(dir, "sms.sqlite");
  let s = new Store(path);
  try {
    const state = newConversation();
    state.request.address = "Private address";
    s.put(sender, state);
    s.close();
    s = new Store(path);
    assert.equal(s.get(sender).request.address, "Private address");
    assert.equal(s.get("+15550000002").request.address, undefined);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("STOP cancels queued jobs/outbox and supersedes an in-flight planner response", () => {
  const s = new Store(":memory:");
  try {
    s.receive("a", sender, "hello");
    const row = s.nextInbound(),
      old = s.get(sender);
    s.enqueue("pending", sender, "old reply");
    s.receive("b", sender, "STOP");
    assert.equal(s.get(sender).stopped, true);
    assert.equal(
      s.db.prepare("SELECT state FROM outbox WHERE id=?").get("pending").state,
      "cancelled",
    );
    assert.equal(
      s.applyTurn(row, old.revision, { state: old, replies: ["late reply"] }),
      false,
    );
  } finally {
    s.close();
  }
});
test("restart never automatically repeats a running phone job or ambiguous SMS send", () => {
  const s = new Store(":memory:");
  try {
    const state = newConversation();
    state.phase = "checking";
    state.revision = 1;
    s.put(sender, state);
    s.db
      .prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?)")
      .run("job", sender, 1, "{}", "running", Date.now());
    s.enqueue("send", sender, "reply");
    s.claimOutbound();
    s.recover();
    assert.equal(s.activeJob("job").state, "interrupted");
    assert.equal(
      s.db.prepare("SELECT state FROM outbox WHERE id=?").get("send").state,
      "uncertain",
    );
    assert.equal(s.get(sender).phase, "ready");
  } finally {
    s.close();
  }
});
test("an expired evidence link cannot read a screenshot", () => {
  const s = new Store(":memory:");
  try {
    const token = s.evidence(sender, "data:image/png;base64,aGVsbG8=");
    assert.ok(s.readEvidence(token));
    s.db.prepare("UPDATE evidence SET expires_at=0").run();
    assert.equal(s.readEvidence(token), undefined);
  } finally {
    s.close();
  }
});
