import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../sms/store.mjs";
import { SMSService } from "../sms/service.mjs";
import {
  simpleInterpret,
  newConversation,
  reduceConversation,
  exampleQuotes,
} from "../dist/conversation.mjs";
const sender = "+15550000001",
  drain = () => new Promise((r) => setImmediate(r));
test("background collection uses only the sender-bound device and returns one result", async () => {
  const store = new Store(":memory:");
  let bound;
  const service = new SMSService({
    store,
    bindings: { [sender]: "own-device" },
    env: {},
    publicBase: "https://sms.example.com",
    send: async () => ({ sid: "mock" }),
    interpret: async (t, s) => simpleInterpret(t, s),
    collect: async (options) => {
      bound = options.env.PHONEUSE_DEVICE_ID;
      return exampleQuotes("rides");
    },
  });
  try {
    let state = newConversation();
    state.mode = "rides";
    state.request = { pickup: "A", destination: "B" };
    store.put(sender, state);
    store.receive("m1", sender, "CHECK");
    await service.processInbound();
    service.startJob();
    await drain();
    assert.equal(bound, "own-device");
    assert.equal(store.get(sender).phase, "done");
    assert.equal(
      store.db
        .prepare("SELECT count(*) AS n FROM jobs WHERE state='done'")
        .get().n,
      1,
    );
  } finally {
    service.stop();
    store.close();
  }
});
test("a cancelled task cannot publish a late result", async () => {
  const store = new Store(":memory:");
  let finish;
  const service = new SMSService({
    store,
    bindings: { [sender]: "own-device" },
    env: {},
    send: async () => ({ sid: "mock" }),
    interpret: async (t, s) => simpleInterpret(t, s),
    collect: () =>
      new Promise((r) => {
        finish = r;
      }),
  });
  try {
    const state = newConversation();
    state.mode = "rides";
    state.request = { pickup: "A", destination: "B" };
    store.put(sender, state);
    store.receive("m1", sender, "CHECK");
    await service.processInbound();
    service.startJob();
    store.receive("m2", sender, "CANCEL");
    await service.processInbound();
    finish(exampleQuotes("rides"));
    await drain();
    assert.deepEqual(store.get(sender).quotes, []);
    assert.equal(
      store.db
        .prepare("SELECT count(*) AS n FROM jobs WHERE state='done'")
        .get().n,
      0,
    );
  } finally {
    service.stop();
    store.close();
  }
});
test("ambiguous outbound network failures are not automatically retried", async () => {
  const store = new Store(":memory:");
  let sends = 0;
  const service = new SMSService({
    store,
    bindings: {},
    send: async () => {
      sends++;
      throw Error("network interrupted");
    },
  });
  try {
    store.enqueue("message", sender, "reply");
    await service.flushOutbound();
    await service.flushOutbound();
    assert.equal(sends, 1);
    assert.equal(
      store.db.prepare("SELECT state FROM outbox WHERE id=?").get("message")
        .state,
      "uncertain",
    );
  } finally {
    service.stop();
    store.close();
  }
});
