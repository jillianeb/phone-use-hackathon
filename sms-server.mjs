import http from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import twilio from "twilio";
import { Store } from "./sms/store.mjs";
import { SMSService } from "./sms/service.mjs";

const phone = /^\+[1-9]\d{7,14}$/;
export function configuration(env) {
  const bindings = JSON.parse(env.SMS_BINDINGS_JSON || "{}");
  if (
    !bindings ||
    typeof bindings !== "object" ||
    Array.isArray(bindings) ||
    Object.entries(bindings).some(
      ([sender, id]) =>
        !phone.test(sender) ||
        typeof id !== "string" ||
        !id.trim() ||
        id.length > 300,
    )
  )
    throw Error(
      "SMS_BINDINGS_JSON must map approved E.164 senders to device IDs",
    );
  if (new Set(Object.values(bindings)).size !== Object.values(bindings).length)
    throw Error("Each SMS sender needs a distinct account/device session");
  let publicBase = "";
  if (env.SMS_PUBLIC_BASE_URL) {
    const u = new URL(env.SMS_PUBLIC_BASE_URL);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/"
    )
      throw Error("SMS_PUBLIC_BASE_URL must be an HTTPS origin without a path");
    publicBase = u.origin;
  }
  const required = [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
    "SMS_PUBLIC_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
  ];
  const missing = required.filter((k) => !env[k]);
  if (!Object.keys(bindings).length) missing.push("SMS_BINDINGS_JSON");
  if (!(env.PHONEUSE_API_KEY || env.PHONEUSE_MCP_COMMAND))
    missing.push("PHONEUSE_API_KEY or PHONEUSE_MCP_COMMAND");
  if (env.TWILIO_PHONE_NUMBER && !phone.test(env.TWILIO_PHONE_NUMBER))
    throw Error("TWILIO_PHONE_NUMBER must use E.164 format");
  if (
    env.TWILIO_ACCOUNT_SID &&
    !/^AC[0-9a-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID)
  )
    throw Error("Invalid TWILIO_ACCOUNT_SID");
  return { bindings, publicBase, missing, ready: missing.length === 0 };
}
export function createSMSApp({
  env = process.env,
  store,
  client,
  collect,
  interpret,
  runWorkers = true,
} = {}) {
  const config = configuration(env);
  store =
    store || new Store(resolve(env.SMS_STATE_DIR || ".state", "sms.sqlite"));
  store.recover();
  client =
    client ||
    (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
      ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, {
          autoRetry: false,
          timeout: 10000,
        })
      : null);
  const service = new SMSService({
    store,
    bindings: config.bindings,
    env,
    collect,
    interpret,
    publicBase: config.publicBase,
    send: async ({ to, body }) =>
      client.messages.create({
        to,
        from: env.TWILIO_PHONE_NUMBER,
        body,
        statusCallback: config.publicBase + "/webhooks/twilio/status",
      }),
  });
  let timer;
  if (runWorkers && config.ready) {
    timer = setInterval(() => service.tick(), 350);
    timer.unref();
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const end = (status, text, type = "text/plain; charset=utf-8") => {
      res.writeHead(status, { "Content-Type": type });
      res.end(text);
    };
    try {
      if (req.url === "/health" && req.method === "GET") {
        end(
          200,
          JSON.stringify({ ok: true, smsConfigured: config.ready }),
          "application/json",
        );
        return;
      }
      if (req.method === "GET" && /^\/evidence\/[a-f0-9]{48}$/.test(req.url)) {
        const image = store.readEvidence(req.url.slice(10));
        if (!image) {
          end(404, "Evidence expired or unavailable");
          return;
        }
        const match = image.match(
          /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/,
        );
        if (!match) {
          end(404, "Unavailable");
          return;
        }
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; frame-ancestors 'none'",
        );
        res.writeHead(200, { "Content-Type": match[1] });
        res.end(Buffer.from(match[2], "base64"));
        return;
      }
      if (
        req.method !== "POST" ||
        !["/webhooks/twilio/sms", "/webhooks/twilio/status"].includes(req.url)
      ) {
        end(404, "Not found");
        return;
      }
      if (!config.ready) {
        end(503, "SMS configuration incomplete");
        return;
      }
      if (
        !req.headers["content-type"]?.startsWith(
          "application/x-www-form-urlencoded",
        )
      ) {
        end(415, "Expected form data");
        return;
      }
      let raw = "",
        size = 0;
      for await (const part of req) {
        size += part.length;
        if (size > 20000) {
          end(413, "Too large");
          return;
        }
        raw += part;
      }
      const form = new URLSearchParams(raw);
      if (new Set(form.keys()).size !== [...form.keys()].length) {
        end(400, "Duplicate parameters");
        return;
      }
      const params = Object.fromEntries(form);
      const valid = twilio.validateRequest(
        env.TWILIO_AUTH_TOKEN,
        req.headers["x-twilio-signature"] || "",
        config.publicBase + req.url,
        params,
      );
      if (!valid || params.AccountSid !== env.TWILIO_ACCOUNT_SID) {
        end(403, "Invalid webhook signature");
        return;
      }
      if (req.url === "/webhooks/twilio/status") {
        if (!/^(SM|MM)[a-f0-9]{32}$/i.test(params.MessageSid || "")) {
          end(400, "Invalid message identifier");
          return;
        }
        if (
          [
            "accepted",
            "scheduled",
            "queued",
            "sending",
            "sent",
            "delivered",
            "undelivered",
            "failed",
            "read",
            "canceled",
          ].includes(params.MessageStatus)
        )
          store.delivery(params.MessageSid, params.MessageStatus);
        end(204, "");
        return;
      }
      if (
        params.To !== env.TWILIO_PHONE_NUMBER ||
        !config.bindings[params.From]
      ) {
        end(403, "Sender or recipient not enabled");
        return;
      }
      if (
        !/^(SM|MM)[a-f0-9]{32}$/i.test(params.MessageSid || "") ||
        typeof params.Body !== "string" ||
        params.Body.length > 1600
      ) {
        end(400, "Invalid message");
        return;
      }
      const body =
        params.OptOutType === "STOP"
          ? "STOP"
          : params.OptOutType === "START"
            ? "START"
            : params.Body.trim();
      if (!body || Number(params.NumMedia || 0) > 0) {
        end(400, "This version accepts text messages only");
        return;
      }
      const urgent = /^(stop|unsubscribe|end|quit|cancel|start)$/i.test(body);
      if (store.hasInbound(params.MessageSid)) {
        end(
          200,
          '<?xml version="1.0" encoding="UTF-8"?><Response/>',
          "text/xml",
        );
        return;
      }
      if (!urgent && store.recentCount(params.From) >= 12) {
        end(429, "Too many messages; try again in a minute");
        return;
      }
      store.receive(params.MessageSid, params.From, body);
      // Acknowledge immediately. Model calls, device actions and outbound SMS happen off-request.
      end(200, '<?xml version="1.0" encoding="UTF-8"?><Response/>', "text/xml");
    } catch {
      if (!res.headersSent) end(500, "Message processing failed");
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return {
    server,
    service,
    store,
    config,
    async close() {
      clearInterval(timer);
      service.stop();
      server.close();
      const until = Date.now() + 5000;
      while (
        (service.running || service.planning || service.sending) &&
        Date.now() < until
      )
        await new Promise((r) => setTimeout(r, 50));
      if (!service.running && !service.planning && !service.sending)
        store.close();
    },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const app = createSMSApp(),
      port = Number(process.env.SMS_PORT || 3111),
      host = process.env.SMS_BIND_HOST || "127.0.0.1";
    app.server.listen(port, host, () =>
      console.log(
        `Fareplay SMS service listening on port ${port}.\n${app.config.ready ? "Configured; end-to-end SMS and phone access still require testing." : "Not activated. Missing: " + app.config.missing.join(", ")}\nNo SMS number is provisioned by this application.`,
      ),
    );
    app.server.on("error", (error) => {
      console.error("SMS service could not listen: " + error.code);
      process.exitCode = 1;
    });
    let stopping = false;
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, async () => {
        if (stopping) return;
        stopping = true;
        await app.close();
        process.exit(0);
      });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
