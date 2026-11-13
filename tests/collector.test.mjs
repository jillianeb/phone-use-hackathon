import test from "node:test";
import assert from "node:assert/strict";
import { collectComparison, boundInventory } from "../collector.mjs";
const inputSchema = { type: "object", properties: {} };
function client() {
  return {
    closed: false,
    calls: [],
    async connect() {},
    async rpc() {
      return {
        tools: ["list_devices", "screenshot"].map((name) => ({
          name,
          inputSchema,
        })),
      };
    },
    async call(name, args) {
      this.calls.push(name);
      return {
        content: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }],
      };
    },
    close() {
      this.closed = true;
    },
  };
}
test("collects providers sequentially, requires evidence and leaves food confirmation to the user", async () => {
  const mcp = client();
  let n = 0;
  const model = async () => ({
    content: [
      ++n % 2 === 1
        ? {
            type: "tool_use",
            id: "shot" + n,
            name: "screenshot",
            input: { device_id: "demo" },
          }
        : {
            type: "tool_use",
            id: "finish" + n,
            name: "finish_quote",
            input: {
              totalCents: 2000,
              etaMinutes: 30,
              tipCents: 300,
              stage: "checkout",
              offer: "",
              note: "",
            },
          },
    ],
  });
  const results = await collectComparison({
    mode: "food",
    request: { tipCents: 300 },
    env: { PHONEUSE_DEVICE_ID: "demo" },
    client: mcp,
    model,
  });
  assert.deepEqual(
    results.map((q) => q.provider),
    ["Uber Eats", "DoorDash"],
  );
  assert.ok(
    results.every((q) => q.basketConfirmed === false && q.evidenceDataUrl),
  );
  assert.equal(mcp.closed, true);
});
test("unsupported tool calls do not execute and yield partial unavailable results", async () => {
  const mcp = client();
  const model = async () => ({
    content: [{ type: "tool_use", id: "bad", name: "delete_app", input: {} }],
  });
  const results = await collectComparison({
    mode: "food",
    request: {},
    env: {},
    client: mcp,
    model,
  });
  assert.deepEqual(mcp.calls, []);
  assert.ok(results.every((q) => q.stage === "unavailable"));
});
test("a different device is rejected before sending the action", async () => {
  const mcp = client();
  const model = async () => ({
    content: [
      {
        type: "tool_use",
        id: "bad",
        name: "screenshot",
        input: { device_id: "someone-else" },
      },
    ],
  });
  const results = await collectComparison({
    mode: "food",
    request: {},
    env: { PHONEUSE_DEVICE_ID: "demo" },
    client: mcp,
    model,
  });
  assert.equal(mcp.calls.length, 0);
  assert.ok(results.every((q) => q.stage === "unavailable"));
});
test("model-reported prices with no screenshot are unavailable", async () => {
  const results = await collectComparison({
    mode: "food",
    request: {},
    env: {},
    client: client(),
    model: async () => ({
      content: [
        {
          type: "tool_use",
          id: "bad",
          name: "finish_quote",
          input: {
            totalCents: 1500,
            etaMinutes: 20,
            tipCents: 300,
            stage: "checkout",
            offer: "",
            note: "",
          },
        },
      ],
    }),
  });
  assert.ok(
    results.every((q) => q.stage === "unavailable" && q.totalCents === null),
  );
});
test("device discovery hides other users devices from the model", () => {
  const output = boundInventory(
    {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            devices: [
              { id: "mine", name: "Own phone" },
              { id: "other", name: "Other user phone" },
            ],
          }),
        },
      ],
    },
    "mine",
  );
  assert.deepEqual(JSON.parse(output.content[0].text).devices, [
    { id: "mine", name: "Own phone" },
  ]);
  assert.equal(boundInventory({ content: [] }, "mine").isError, true);
});
test("cancellation after progress callback stops before the next device action", async () => {
  const mcp = client(),
    controller = new AbortController();
  const model = async () => ({
    content: [
      {
        type: "tool_use",
        id: "s",
        name: "screenshot",
        input: { device_id: "demo" },
      },
    ],
  });
  await assert.rejects(() =>
    collectComparison({
      mode: "food",
      request: {},
      env: {},
      client: mcp,
      model,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.includes("screenshot")) controller.abort();
      },
    }),
  );
  assert.equal(mcp.calls.length, 0);
  assert.equal(mcp.closed, true);
});
