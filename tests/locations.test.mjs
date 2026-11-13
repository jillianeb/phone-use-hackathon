import test from "node:test";
import assert from "node:assert/strict";
import {
  newConversation,
  simpleInterpret,
  reduceConversation,
  completeComparison,
  exampleQuotes,
} from "../dist/conversation.mjs";
import { validateQuote } from "../dist/core.mjs";
import { collectComparison } from "../collector.mjs";
const turn = (state, text) =>
  reduceConversation(state, simpleInterpret(text, state));
test("a destination name alone in a ride request asks for a pickup place, not an address", () => {
  let result = turn(newConversation(), "Get me to SFO");
  assert.equal(result.state.request.destination, "SFO");
  assert.equal(result.state.awaiting, "pickup");
  assert.doesNotMatch(result.replies[0], /exact|street address/i);
  result = turn(result.state, "Ferry Building, San Francisco");
  assert.equal(result.state.request.pickup, "Ferry Building, San Francisco");
  assert.equal(result.state.phase, "ready");
  assert.match(result.replies[0], /CHECK/);
});
test("ride place names do not swallow budget and time clauses", () => {
  const result = turn(
    newConversation(),
    "Ride from Ferry Building to SFO under $30 within 45 minutes",
  );
  assert.equal(result.state.request.pickup, "Ferry Building");
  assert.equal(result.state.request.destination, "SFO");
  assert.equal(result.state.request.maxCents, 3000);
  assert.equal(result.state.request.maxMinutes, 45);
});
test("restaurant and delivery landmarks work without street addresses or semicolons", () => {
  const result = turn(
    newConversation(),
    "Compare 2 burritos from Chipotle near Moscone Center deliver to Moscone Center, San Francisco under $35",
  );
  assert.equal(result.state.request.restaurant, "Chipotle near Moscone Center");
  assert.equal(result.state.request.address, "Moscone Center, San Francisco");
  assert.equal(result.state.phase, "ready");
});
test("a restaurant name inside a ride request does not switch to food", () => {
  const result = turn(newConversation(), "Ride from Burger King to SFO");
  assert.equal(result.state.mode, "rides");
  assert.equal(result.state.request.pickup, "Burger King");
});
test("here needs a real place description and is replaced when clarified", () => {
  const result = turn(newConversation(), "Ride from here to SFO");
  assert.equal(result.state.phase, "clarifying");
  assert.equal(result.job, undefined);
  const clarified = turn(result.state, "Ferry Building, San Francisco");
  assert.equal(clarified.state.request.pickup, "Ferry Building, San Francisco");
  assert.equal(clarified.state.phase, "ready");
});
test("provider ambiguity pauses the comparison and preserves the original place when adding city context", () => {
  const ready = turn(
      newConversation(),
      "Ride from Ferry Building to Union Square",
    ),
    checking = turn(ready.state, "CHECK");
  const quote = {
    provider: "Uber",
    stage: "unavailable",
    totalCents: null,
    observedAt: new Date().toISOString(),
    clarification: {
      field: "destination",
      question: "Union Square in San Francisco or New York?",
    },
  };
  const result = completeComparison(checking.state, checking.job, [quote]);
  assert.equal(result.state.awaiting, "destination");
  assert.equal(result.state.quotes.length, 0);
  assert.match(result.replies[0], /San Francisco or New York/);
  assert.doesNotMatch(result.replies[0], /Best qualifying/);
  const reply = turn(result.state, "San Francisco");
  assert.equal(reply.state.request.destination, "Union Square, San Francisco");
  assert.equal(reply.state.phase, "ready");
  assert.equal(reply.job, undefined);
});
test("an ambiguous location cannot be paired with a ranked price or wrong category field", () => {
  const base = {
    provider: "Uber",
    stage: "unavailable",
    totalCents: null,
    observedAt: new Date().toISOString(),
    clarification: { field: "destination", question: "Which city?" },
  };
  assert.throws(() =>
    validateQuote({ ...base, stage: "checkout", totalCents: 1500 }, "rides"),
  );
  assert.throws(() =>
    validateQuote(
      {
        ...base,
        clarification: { field: "restaurant", question: "Which branch?" },
      },
      "rides",
    ),
  );
});
test("the collector stops further provider checks when it needs a location clarification", async () => {
  let calls = 0;
  const client = {
    async connect() {},
    async rpc() {
      return {
        tools: ["list_devices", "screenshot"].map((name) => ({
          name,
          inputSchema: { type: "object", properties: {} },
        })),
      };
    },
    close() {},
  };
  const quotes = await collectComparison({
    mode: "rides",
    request: { pickup: "Ferry Building", destination: "Union Square" },
    client,
    env: {},
    model: async () => {
      calls++;
      return {
        content: [
          {
            type: "tool_use",
            id: "clarify",
            name: "finish_quote",
            input: {
              totalCents: null,
              etaMinutes: null,
              tipCents: null,
              stage: "unavailable",
              offer: "",
              note: "",
              clarification: {
                field: "destination",
                question: "Which city for Union Square?",
              },
            },
          },
        ],
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].clarification.field, "destination");
});
