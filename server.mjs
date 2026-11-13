import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { collectComparison } from "./collector.mjs";
const root = new URL("./dist/", import.meta.url),
  token = randomBytes(32).toString("hex"),
  port = Number(process.env.PORT || 3110),
  jobs = new Map();
let busy = false;
const configured = () =>
  !!(
    (process.env.PHONEUSE_API_KEY || process.env.PHONEUSE_MCP_COMMAND) &&
    process.env.ANTHROPIC_API_KEY &&
    process.env.ANTHROPIC_MODEL
  );
const send = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
const server = http.createServer(async (req, res) => {
  const host = req.headers.host;
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) {
    send(res, 403, { error: "Invalid host" });
    return;
  }
  const origin = req.headers.origin;
  if (
    origin &&
    !["http://127.0.0.1:" + port, "http://localhost:" + port].includes(origin)
  ) {
    send(res, 403, { error: "Invalid origin" });
    return;
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  try {
    if (path.startsWith("/api/")) {
      if (req.headers["x-fareplay-token"] !== token) {
        send(res, 403, {
          error: "Reload the local app to authorize this request",
        });
        return;
      }
      if (path === "/api/status" && req.method === "GET") {
        send(res, 200, { configured: configured(), busy });
        return;
      }
      if (path.startsWith("/api/jobs/") && req.method === "GET") {
        const job = jobs.get(path.slice(10));
        send(res, job ? 200 : 404, job || { error: "Job not found" });
        return;
      }
      if (path === "/api/compare" && req.method === "POST") {
        if (!configured()) {
          send(res, 503, {
            error:
              "Configure PhoneUse, ANTHROPIC_API_KEY and ANTHROPIC_MODEL before collecting",
          });
          return;
        }
        if (busy) {
          send(res, 409, { error: "One phone comparison is already running" });
          return;
        }
        let body = "",
          size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 12000) {
            send(res, 413, { error: "Request too large" });
            return;
          }
          body += chunk;
        }
        let data;
        try {
          data = JSON.parse(body);
        } catch {
          send(res, 400, { error: "Invalid JSON" });
          return;
        }
        const { mode, request: r } = data;
        if (!["food", "rides"].includes(mode) || !r || typeof r !== "object") {
          send(res, 400, { error: "Invalid comparison" });
          return;
        }
        const required =
          mode === "food"
            ? ["restaurant", "basket", "address"]
            : ["pickup", "destination"];
        if (
          required.some(
            (k) =>
              typeof r[k] !== "string" || !r[k].trim() || r[k].length > 2000,
          ) ||
          (mode === "food" &&
            (!Number.isSafeInteger(r.tipCents) ||
              r.tipCents < 0 ||
              r.tipCents > 100000)) ||
          (r.maxMinutes != null &&
            (!Number.isInteger(r.maxMinutes) ||
              r.maxMinutes < 1 ||
              r.maxMinutes > 1440))
        ) {
          send(res, 400, {
            error: "Enter valid trip/basket details and time/tip limits",
          });
          return;
        }
        const request = Object.fromEntries(
          [...required, "tipCents", "maxMinutes"]
            .filter((k) => r[k] !== undefined)
            .map((k) => [k, r[k]]),
        );
        // Jobs and evidence stay in memory and expire; never persist credentials or screenshots.
        for (const [id, job] of jobs)
          if (job.state !== "running") jobs.delete(id);
        const job = {
          id: randomUUID(),
          state: "running",
          events: [],
          quotes: [],
          createdAt: Date.now(),
        };
        jobs.set(job.id, job);
        busy = true;
        send(res, 202, { id: job.id });
        collectComparison({
          mode,
          request,
          onEvent: (event) => {
            job.events.push(event);
            if (job.events.length > 100) job.events.shift();
          },
          onQuote: (q) => job.quotes.push(q),
        })
          .then(() => {
            job.state = "done";
          })
          .catch((error) => {
            job.state = "failed";
            job.error = error.message;
          })
          .finally(() => {
            busy = false;
            const expiry = setTimeout(() => jobs.delete(job.id), 3600000);
            expiry.unref();
          });
        return;
      }
      send(res, 404, { error: "Unknown API operation" });
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      send(res, 405, { error: "Method not allowed" });
      return;
    }
    const files = {
      "/": "index.html",
      "/index.html": "index.html",
      "/compare.html": "compare.html",
      "/chat.mjs": "chat.mjs",
      "/chat.css": "chat.css",
      "/conversation.mjs": "conversation.mjs",
      "/app.mjs": "app.mjs",
      "/core.mjs": "core.mjs",
      "/style.css": "style.css",
    };
    const file = files[path];
    if (!file) {
      send(res, 404, { error: "Not found" });
      return;
    }
    let content = await readFile(new URL(file, root));
    if (file === "compare.html")
      content = Buffer.from(
        content.toString().replace("__LOCAL_TOKEN__", token),
      );
    const type = file.endsWith(".html")
      ? "text/html; charset=utf-8"
      : file.endsWith(".css")
        ? "text/css"
        : "text/javascript";
    res.writeHead(200, { "Content-Type": type });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch {
    if (!res.headersSent)
      send(res, 500, { error: "Local server operation failed" });
    else res.end();
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Fareplay: http://127.0.0.1:${port}\nCollector ${configured() ? "configured (device not yet verified)" : "not configured — manual quotes and examples work"}`,
  ),
);
server.on("error", (error) => {
  console.error(
    `Could not start local server: ${error.code || "unknown error"}`,
  );
  process.exitCode = 1;
});
