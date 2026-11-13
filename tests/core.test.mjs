import test from "node:test";
import assert from "node:assert/strict";
import { rank, eligibility, validateQuote } from "../dist/core.mjs";
const quote = (provider, totalCents, extra = {}) =>
  validateQuote(
    {
      provider,
      totalCents,
      etaMinutes: 30,
      tipCents: 300,
      stage: "checkout",
      basketConfirmed: true,
      source: "manual",
      observedAt: new Date().toISOString(),
      ...extra,
    },
    "food",
  );
test("ranks final totals without subtracting applied discounts again", () => {
  const a = quote("Uber Eats", 2875, { offer: "$5 off already applied" }),
    b = quote("DoorDash", 3220);
  const r = rank([a, b], "food", { tipCents: 300 });
  assert.equal(r.cheapest, a);
  assert.equal(r.savings, 345);
});
test("food comparison rejects different tips and unconfirmed baskets", () => {
  const a = quote("Uber Eats", 1000, { tipCents: 0 }),
    b = quote("DoorDash", 1200, { basketConfirmed: false });
  assert.equal(rank([a, b], "food", { tipCents: 300 }).cheapest, null);
  assert.match(eligibility(a, "food", { tipCents: 300 }), /Tip differs/);
});
test("menu estimates and missing checkout totals cannot win food", () => {
  assert.equal(
    rank(
      [quote("Uber Eats", 500, { stage: "estimate" }), quote("DoorDash", null)],
      "food",
      { tipCents: 300 },
    ).count,
    0,
  );
});
test("deadline changes can change the cheapest eligible ride", () => {
  const q = (provider, totalCents, etaMinutes) =>
    validateQuote(
      {
        provider,
        totalCents,
        etaMinutes,
        stage: "estimate",
        observedAt: new Date().toISOString(),
      },
      "rides",
    );
  const uber = q("Uber", 1900, 20),
    transit = q("Transit", 300, 45);
  assert.equal(
    rank([uber, transit], "rides", { maxMinutes: 30 }).cheapest,
    uber,
  );
  assert.equal(
    rank([uber, transit], "rides", { maxMinutes: 60 }).cheapest,
    transit,
  );
});
test("unknown time does not satisfy a deadline; known zero price remains valid", () => {
  const q = quote("Uber Eats", 0, { etaMinutes: null });
  assert.equal(rank([q], "food", { tipCents: 300, maxMinutes: 30 }).count, 0);
  assert.equal(rank([q], "food", { tipCents: 300 }).cheapest.totalCents, 0);
});
test("rejects malformed money and unsupported evidence URLs", () => {
  assert.throws(() => quote("Uber Eats", -1));
  assert.throws(() => quote("Uber Eats", 12.5));
  assert.throws(() => quote("Uber Eats", NaN));
  assert.throws(() =>
    quote("Uber Eats", 100, { evidenceDataUrl: "javascript:alert(1)" }),
  );
});
