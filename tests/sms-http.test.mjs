import test from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import { Store } from "../sms/store.mjs";
import { createSMSApp, configuration } from "../sms-server.mjs";
const env = {
  TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
  TWILIO_AUTH_TOKEN: "fake-test-token-not-a-real-credential",
  TWILIO_PHONE_NUMBER: "+15550000000",
  SMS_PUBLIC_BASE_URL: "https://sms.example.com",
  SMS_BINDINGS_JSON: JSON.stringify({ "+15550000001": "device-test" }),
  ANTHROPIC_API_KEY: "fake",
  ANTHROPIC_MODEL: "fake",
  PHONEUSE_API_KEY: "fake",
};
const payload = () => ({
  AccountSid: env.TWILIO_ACCOUNT_SID,
  MessageSid: "SM" + "b".repeat(32),
  To: env.TWILIO_PHONE_NUMBER,
  From: "+15550000001",
  Body: "help",
  NumMedia: "0",
});
async function fixture(fn) {
  const app = createSMSApp({
    env,
    store: new Store(":memory:"),
    client: {
      messages: { create: async () => ({ sid: "SM" + "c".repeat(32) }) },
    },
    runWorkers: false,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  try {
    await fn(app, `http://127.0.0.1:${app.server.address().port}`);
  } finally {
    await app.close();
  }
}
async function post(base, params, valid = true, path = "/webhooks/twilio/sms") {
  const signature = twilio.getExpectedTwilioSignature(
    env.TWILIO_AUTH_TOKEN,
    env.SMS_PUBLIC_BASE_URL + path,
    params,
  );
  return fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": valid ? signature : "bad",
    },
    body: new URLSearchParams(params),
  });
}
test("signed webhook is acknowledged immediately and duplicate delivery is stored once", () =>
  fixture(async (app, base) => {
    const p = payload();
    const a = await post(base, p);
    assert.equal(a.status, 200);
    assert.match(await a.text(), /<Response\/>/);
    assert.equal((await post(base, p)).status, 200);
    assert.equal(
      app.store.db.prepare("SELECT count(*) AS n FROM inbox").get().n,
      1,
    );
    assert.equal(
      app.store.db.prepare("SELECT count(*) AS n FROM outbox").get().n,
      0,
    );
  }));
test("invalid signatures and unbound users cannot enqueue work", () =>
  fixture(async (app, base) => {
    assert.equal((await post(base, payload(), false)).status, 403);
    assert.equal(
      (await post(base, { ...payload(), From: "+15550000002" })).status,
      403,
    );
    assert.equal(app.store.nextInbound(), undefined);
  }));
test("signed STOP suppresses pending responses before background interpretation", () =>
  fixture(async (app, base) => {
    app.store.enqueue("pending", "+15550000001", "do not send");
    assert.equal(
      (await post(base, { ...payload(), Body: "STOP" })).status,
      200,
    );
    assert.equal(app.store.get("+15550000001").stopped, true);
    assert.equal(app.store.claimOutbound(), null);
  }));
test("signed delivery callbacks update only a known outbound message", () =>
  fixture(async (app, base) => {
    app.store.enqueue("o", "+15550000001", "reply");
    app.store.sent("o", "SM" + "c".repeat(32));
    const response = await post(
      base,
      {
        AccountSid: env.TWILIO_ACCOUNT_SID,
        MessageSid: "SM" + "c".repeat(32),
        MessageStatus: "delivered",
      },
      true,
      "/webhooks/twilio/status",
    );
    assert.equal(response.status, 204);
    assert.equal(
      app.store.db
        .prepare("SELECT delivery_status FROM outbox WHERE id=?")
        .get("o").delivery_status,
      "delivered",
    );
  }));
test("configuration requires dedicated sender-device bindings and rejects non-HTTPS origins", () => {
  assert.throws(() =>
    configuration({ ...env, SMS_PUBLIC_BASE_URL: "http://example.com" }),
  );
  assert.throws(() =>
    configuration({
      ...env,
      SMS_BINDINGS_JSON: JSON.stringify({
        "+15550000001": "same",
        "+15550000002": "same",
      }),
    }),
  );
  assert.equal(configuration({}).ready, false);
});
