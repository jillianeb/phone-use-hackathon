import test from "node:test";
import assert from "node:assert/strict";
import {
  newConversation,
  simpleInterpret,
  reduceConversation,
  completeComparison,
  exampleQuotes,
} from "../dist/conversation.mjs";
const food =
  "Compare 2 veggie burritos from Demo Kitchen, 123 Market St; deliver to 456 Pine St; tip $3; under $35; within 45 minutes";
const turn = (state, text) =>
  reduceConversation(state, simpleInterpret(text, state));
function ready() {
  return turn(newConversation(), food).state;
}
function done() {
  const plan = turn(ready(), "CHECK");
  return completeComparison(plan.state, plan.job, exampleQuotes("food")).state;
}
test("extracts an exact food request and asks for confirmation before phone work", () => {
  const p = turn(newConversation(), food);
  assert.equal(p.state.request.maxCents, 3500);
  assert.equal(p.state.request.maxMinutes, 45);
  assert.equal(p.state.request.tipCents, 300);
  assert.equal(p.state.request.address, "456 Pine St");
  assert.equal(p.state.phase, "ready");
  assert.equal(p.job, undefined);
  assert.match(p.replies[0], /CHECK/);
});
test("collects missing details one at a time and remembers previous answers", () => {
  let p = turn(newConversation(), "food");
  assert.equal(p.state.awaiting, "restaurant");
  p = turn(p.state, "Demo Kitchen, 123 Main St");
  assert.equal(p.state.awaiting, "basket");
  p = turn(p.state, "2 regular veggie burritos");
  assert.equal(p.state.awaiting, "address");
  p = turn(p.state, "456 Pine St");
  assert.equal(p.state.phase, "ready");
  assert.equal(p.state.request.basket, "2 regular veggie burritos");
});
test("follow-up deadline changes recommendation without a new phone job", () => {
  const p = turn(done(), "within 30 minutes");
  assert.equal(p.job, undefined);
  assert.match(p.replies[0], /Best qualifying price: DoorDash/);
  assert.match(p.replies[0], /DEMO/);
});
test("an impossible budget is reported instead of silently violated", () => {
  assert.match(
    turn(done(), "under $20").replies[0],
    /None of the verified options/,
  );
});
test("changing basket invalidates quotes and requires CHECK again", () => {
  const p = turn(done(), "Basket: 3 veggie burritos");
  assert.equal(p.state.quotes.length, 0);
  assert.equal(p.state.phase, "ready");
  assert.equal(p.job, undefined);
});
test("a request changed mid-run cancels old work and rejects stale completion", () => {
  const p = turn(ready(), "CHECK"),
    updated = turn(p.state, "within 25 minutes");
  assert.equal(updated.cancel, true);
  assert.equal(
    completeComparison(updated.state, p.job, exampleQuotes("food")),
    null,
  );
});
test("new conversation revisions cannot collide with an old job", () => {
  const old = turn(ready(), "CHECK"),
    reset = turn(old.state, "new");
  assert.ok(reset.state.revision > old.job.revision);
  assert.equal(
    completeComparison(reset.state, old.job, exampleQuotes("food")),
    null,
  );
});
test("live food prices stay provisional until the user confirms baskets", () => {
  const p = turn(ready(), "CHECK"),
    quotes = exampleQuotes("food").map((q) => ({
      ...q,
      source: "live",
      basketConfirmed: false,
    }));
  const result = completeComparison(p.state, p.job, quotes);
  assert.match(result.replies[0], /Provisional/);
  assert.doesNotMatch(result.replies[0], /Best qualifying/);
  assert.match(turn(result.state, "MATCH").replies[0], /Best qualifying price/);
});
test("stale live quotes require refresh even after a deadline follow-up", () => {
  const p = turn(ready(), "CHECK"),
    quotes = exampleQuotes("food").map((q) => ({ ...q, source: "live" }));
  const state = completeComparison(
    p.state,
    p.job,
    quotes,
    Date.now() - 360000,
  ).state;
  assert.match(turn(state, "within 40 minutes").replies[0], /REFRESH/);
  assert.doesNotMatch(
    turn(state, "within 40 minutes").replies[0],
    /Best qualifying/,
  );
});
test("STOP blocks replies until START and execution requests cannot purchase", () => {
  const stopped = turn(ready(), "stop");
  assert.equal(stopped.state.stopped, true);
  assert.deepEqual(turn(stopped.state, "help").replies, []);
  assert.equal(turn(stopped.state, "START").state.stopped, false);
  assert.match(turn(done(), "order it").replies[0], /have not placed an order/);
});
test("ride switch does not reuse a food address or its quotes", () => {
  const p = turn(
    done(),
    "Compare a ride from 1 Pine St to 2 Main St; within 30 minutes",
  );
  assert.equal(p.state.mode, "rides");
  assert.equal(p.state.request.pickup, "1 Pine St");
  assert.equal(p.state.request.address, undefined);
  assert.deepEqual(p.state.quotes, []);
});
