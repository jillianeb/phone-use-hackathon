import { rank, eligibility, money, validateQuote } from "./core.mjs";
export const newConversation = () => ({
  version: 1,
  revision: 0,
  mode: null,
  request: { tipCents: 300 },
  quotes: [],
  phase: "gathering",
  awaiting: null,
  stopped: false,
  checkedAt: null,
});
const fields = new Set([
  "restaurant",
  "basket",
  "address",
  "pickup",
  "destination",
  "tipCents",
  "maxMinutes",
  "maxCents",
]);
const numberFields = new Set(["tipCents", "maxMinutes", "maxCents"]);
const locationFields = new Set([
  "restaurant",
  "address",
  "pickup",
  "destination",
]);
// Preserve the user's place-name query; don't invent an address or coordinates.
function locationText(value) {
  return value
    .split(
      /;|\s+(?=(?:deliver(?:y)?\s+to|send\s+to|tip\s*\$|under\s*\$|within\s+\d+\s*min|budget\s*\$))/i,
    )[0]
    .replace(/[,\s]+$/, "")
    .trim();
}
export function cleanPatch(raw = {}) {
  const patch = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!fields.has(k)) continue;
    if (v === null && ["maxMinutes", "maxCents"].includes(k)) {
      patch[k] = null;
      continue;
    }
    if (numberFields.has(k)) {
      if (
        !Number.isSafeInteger(v) ||
        v < 0 ||
        v > (k === "maxMinutes" ? 1440 : 1000000) ||
        (k === "maxMinutes" && v === 0)
      )
        throw Error("Invalid request limit");
      patch[k] = v;
    } else {
      if (typeof v !== "string" || !v.trim() || v.length > 2000)
        throw Error("Invalid request detail");
      patch[k] = v.trim();
    }
  }
  return patch;
}
export function simpleInterpret(text, state = newConversation()) {
  const t = text.trim(),
    low = t.toLowerCase(),
    patch = {};
  let intent = "request",
    mode = null;
  if (/^(stop|unsubscribe|cancel subscription|end|quit)$/i.test(t))
    return { intent: "stop", patch };
  if (/^start$/i.test(t)) return { intent: "start", patch };
  if (/^(cancel|never mind|nevermind)$/i.test(t))
    return { intent: "cancel", patch };
  if (/^(new|reset|start over)$/i.test(t)) return { intent: "new", patch };
  if (/^(help|hi|hello|hey)$/i.test(t)) return { intent: "help", patch };
  if (/^(check|compare|yes|refresh|check again|go ahead)$/i.test(t))
    return {
      intent:
        low.includes("refresh") || low === "check again" ? "refresh" : "check",
      patch,
    };
  if (/^(match|baskets match|confirmed)$/i.test(t))
    return { intent: "match", patch };
  if (
    /^(why|why\?|explain|show offers|offers|discounts|faster|fastest|which is faster\??)$/i.test(
      t,
    )
  )
    return { intent: low.includes("faste") ? "fastest" : "why", patch };
  if (/^(status|update|any update\??)$/i.test(t))
    return { intent: "status", patch };
  if (
    /^(buy|book|order it|place order|order that|book it|purchase|pay)\b/i.test(
      t,
    )
  )
    return { intent: "order", patch };
  if (
    /\b(rides?|uberx?|lyft|transit|(?:take|bring|get)\s+(?:me\s+)?to)\b/i.test(
      t,
    ) &&
    !/\buber\s+eats\b/i.test(t)
  )
    mode = "rides";
  else if (
    /\b(food|burritos?|pizzas?|burgers?|dinner|lunch|ubereats|uber eats|doordash|deliver(?:y)?)\b/i.test(
      t,
    )
  )
    mode = "food";
  else if (/\bfrom\s+.+\s+to\s+.+/i.test(t)) mode = "rides";
  const moneyMatch = t.match(
    /(?:under|budget(?: of)?|less than|no more than|up to)\s*\$\s*(\d+(?:\.\d{1,2})?)/i,
  );
  if (moneyMatch) patch.maxCents = Math.round(Number(moneyMatch[1]) * 100);
  const timeMatch = t.match(
    /(?:within|in|under|less than|at most)\s*(\d+)\s*(?:min(?:ute)?s?)\b/i,
  );
  if (timeMatch) patch.maxMinutes = Number(timeMatch[1]);
  const tipMatch = t.match(
    /(?:tip(?: of)?\s*\$\s*(\d+(?:\.\d{1,2})?)|\$(\d+(?:\.\d{1,2})?)\s*tip)/i,
  );
  if (tipMatch)
    patch.tipCents = Math.round(Number(tipMatch[1] || tipMatch[2]) * 100);
  if (/\b(no deadline|no time limit)\b/i.test(t)) patch.maxMinutes = null;
  if (/\b(no budget|no budget limit)\b/i.test(t)) patch.maxCents = null;
  for (const [label, key] of [
    ["restaurant", "restaurant"],
    ["basket", "basket"],
    ["address", "address"],
    ["delivery location", "address"],
    ["pickup", "pickup"],
    ["destination", "destination"],
  ]) {
    const match = t.match(
      new RegExp("(?:^|;)\\s*" + label + "\\s*:\\s*([^;]+)", "i"),
    );
    if (match)
      patch[key] = locationFields.has(key)
        ? locationText(match[1])
        : match[1].trim();
  }
  const activeMode = mode || state.mode;
  if (activeMode === "food") {
    const basket = t.match(
      /(?:compare|get|order|want|need)\s+(.+?)\s+from\s+([^;]+)/i,
    );
    if (basket) {
      patch.basket = basket[1].trim();
      patch.restaurant = locationText(basket[2]);
    }
    const address = t.match(/(?:deliver(?:y)?\s+to|send\s+to)\s+([^;]+)/i);
    if (address) patch.address = locationText(address[1]);
  } else if (activeMode === "rides") {
    const trip = t.match(/\bfrom\s+(.+?)\s+to\s+([^;]+)/i);
    if (trip) {
      patch.pickup = locationText(trip[1]);
      patch.destination = locationText(trip[2]);
    }
    const destination = t.match(
      /(?:\b(?:take|bring|get)\s+(?:me\s+)?to|\b(?:ride|trip)\s+to)\s+(.+)/i,
    );
    if (!trip && destination) patch.destination = locationText(destination[1]);
  }
  const at = t.match(
    /(?:\bI(?:['’]m| am)\s+at|\bpick\s+me\s+up\s+(?:at|from))\s+(.+?)(?=\s+and\s+|;|$)/i,
  );
  if (at)
    patch[activeMode === "food" ? "address" : "pickup"] = locationText(at[1]);
  if (
    !Object.keys(patch).length &&
    state.awaiting &&
    fields.has(state.awaiting)
  )
    patch[state.awaiting] =
      state.phase === "clarifying" &&
      locationFields.has(state.awaiting) &&
      !/^(here|near me|my location|current location|home|work)$/i.test(
        state.request[state.awaiting]?.trim(),
      )
        ? `${state.request[state.awaiting]}, ${t}`
        : t;
  return { intent, mode, patch };
}
export function summary(state) {
  const r = state.request;
  return state.mode === "food"
    ? `${r.basket} from ${r.restaurant}; deliver to ${r.address}; ${money(r.tipCents)} tip included`
    : `${r.pickup} to ${r.destination}; UberX, Lyft Standard and transit`;
}
export function eligibleQuotes(state) {
  return state.quotes.filter(
    (q) =>
      !eligibility(q, state.mode, state.request) &&
      (state.request.maxCents == null ||
        q.totalCents <= state.request.maxCents),
  );
}
export function recommendation(state, now = Date.now()) {
  const example = state.quotes.some((q) => q.source === "example"),
    prefix = example ? "DEMO - invented prices.\n" : "";
  if (!state.quotes.length)
    return "No prices collected yet. Reply CHECK after entering your request.";
  const stale = now - Date.parse(state.checkedAt || 0) > 300000;
  const lines = state.quotes.map(
    (q) =>
      `${q.provider}: ${q.totalCents == null ? "unavailable" : money(q.totalCents)}${q.etaMinutes != null ? `, about ${q.etaMinutes} min` : ""}${q.offer ? `; ${q.offer}` : ""}${q.stage === "estimate" ? " (estimate)" : ""}.`,
  );
  if (stale && !example)
    return (
      prefix +
      lines.join("\n") +
      "\nThese prices are over 5 minutes old. Reply REFRESH to check again before choosing."
    );
  const unconfirmed =
    state.mode === "food" &&
    state.quotes.some((q) => q.totalCents != null && !q.basketConfirmed);
  if (unconfirmed)
    return (
      prefix +
      lines.join("\n") +
      "\nProvisional: verify the same branch, basket and address in the supporting screenshots/apps, then reply MATCH. No order placed."
    );
  const eligible = eligibleQuotes(state),
    best = rank(eligible, state.mode, state.request).cheapest;
  if (!best)
    return (
      prefix +
      lines.join("\n") +
      "\nNone of the verified options meets every limit. Tell me a higher budget or longer time limit."
    );
  const result = rank(eligible, state.mode, state.request);
  return (
    prefix +
    `Best qualifying price: ${best.provider}, ${money(best.totalCents)}${best.etaMinutes != null ? `, about ${best.etaMinutes} min` : ""}.\n` +
    lines.join("\n") +
    `\n${result.count > 1 ? `${money(result.savings)} less than the highest qualifying quote. ` : ""}You can change your budget or arrival limit. No booking or order placed.`
  );
}
export function reduceConversation(previous, interpretation, now = Date.now()) {
  let state = structuredClone(previous),
    { intent = "request", mode, patch: rawPatch = {} } = interpretation;
  const patch = cleanPatch(rawPatch);
  if (intent === "stop") {
    state.stopped = true;
    state.revision++;
    state.phase = "gathering";
    return { state, replies: [], cancel: true };
  }
  if (state.stopped && intent !== "start") return { state, replies: [] };
  if (intent === "start") {
    state.stopped = false;
    return {
      state,
      replies: [
        "Fareplay is ready. Text a food basket or a trip. I compare prices; I do not place orders. Reply HELP for examples.",
      ],
    };
  }
  if (intent === "new") {
    const revision = state.revision + 1;
    state = newConversation();
    state.revision = revision;
    return {
      state,
      replies: [
        "New request. Tell me what food to compare, or your pickup and destination.",
      ],
      cancel: true,
    };
  }
  if (intent === "cancel") {
    state.revision++;
    state.phase = "gathering";
    state.quotes = [];
    return {
      state,
      replies: [
        "Cancelled. An action already sent to the phone may finish; no new actions should start. Tell me what you want to compare next.",
      ],
      cancel: true,
    };
  }
  if (intent === "order")
    return {
      state,
      replies: [
        "This version compares prices only. Complete any purchase in the provider app after checking the current total. I have not placed an order.",
      ],
    };
  if (intent === "help")
    return {
      state,
      replies: [
        'Food: "Compare 2 veggie burritos from Chipotle near Moscone Center; deliver to Moscone Center, San Francisco; tip $3; under $35."\nRides: "Get me to SFO" or "Ride from Ferry Building to Union Square, San Francisco." Place names, landmarks and addresses all work. I will ask when a place is unclear.\nCHECK starts a comparison; CANCEL stops a task; NEW resets; STOP stops replies.',
      ],
    };
  if (intent === "status")
    return {
      state,
      replies: [
        state.phase === "checking"
          ? "Your comparison is queued or running. I will text the results when it finishes."
          : state.quotes.length
            ? recommendation(state, now)
            : "No comparison is running. Tell me a trip or food basket.",
      ],
    };
  if (intent === "why")
    return {
      state,
      replies: [
        state.quotes.length
          ? recommendation(state, now) +
            "\nI use displayed totals, including applied offers. I never subtract an offer twice or assume coupons stack."
          : "I choose the lowest verified total that meets your budget and time limit. Food must have a matching basket and tip.",
      ],
    };
  if (intent === "fastest") {
    const choices = eligibleQuotes(state)
      .filter((q) => q.etaMinutes != null)
      .sort((a, b) => a.etaMinutes - b.etaMinutes);
    return {
      state,
      replies: [
        choices.length
          ? `${state.quotes.some((q) => q.source === "example") ? "DEMO - invented prices. " : ""}Fastest qualifying option: ${choices[0].provider}, about ${choices[0].etaMinutes} min, ${money(choices[0].totalCents)}.${now - Date.parse(state.checkedAt || 0) > 300000 ? " Prices may be stale; reply REFRESH." : ""}`
          : "No eligible option with a known arrival time yet.",
      ],
    };
  }
  if (intent === "match") {
    if (state.mode !== "food" || !state.quotes.length)
      return {
        state,
        replies: ["There is no food comparison to confirm yet."],
      };
    if (
      now - Date.parse(state.checkedAt || 0) > 300000 &&
      !state.quotes.some((q) => q.source === "example")
    )
      return {
        state,
        replies: [
          "Those quotes are stale. Reply REFRESH before confirming baskets.",
        ],
      };
    state.quotes = state.quotes.map((q) => ({ ...q, basketConfirmed: true }));
    return { state, replies: [recommendation(state, now)] };
  }
  const changedMode = mode && mode !== state.mode;
  if (changedMode) {
    state.mode = mode;
    state.request = { tipCents: 300 };
    state.quotes = [];
    state.phase = "gathering";
    state.awaiting = null;
    state.revision++;
  }
  const changed = Object.keys(patch).filter(
    (k) => JSON.stringify(patch[k]) !== JSON.stringify(state.request[k]),
  );
  const substantive = changed.some(
    (k) => !["maxCents", "maxMinutes"].includes(k),
  );
  const cancelNeeded = !!(
    substantive ||
    changedMode ||
    (changed.length && previous.phase === "checking")
  );
  if (changed.length) {
    Object.assign(state.request, patch);
    if (substantive || state.phase === "checking") {
      state.quotes = [];
      state.phase = "gathering";
      state.revision++;
    }
  }
  if (!state.mode)
    return {
      state,
      replies: [
        "Are you comparing food delivery or a trip? Text FOOD or RIDES, or describe what you need.",
      ],
    };
  const required =
    state.mode === "food"
      ? ["restaurant", "basket", "address"]
      : ["pickup", "destination"];
  const missing = required.find((k) => !state.request[k]);
  if (missing) {
    state.awaiting = missing;
    const questions = {
      restaurant:
        "Which restaurant? A name or nearby landmark is enough to start, such as Chipotle near Moscone Center.",
      basket: "What exact items, quantities, sizes and modifications?",
      address:
        "Where should it be delivered? Send a place name, landmark, hotel or address; add the city if needed.",
      pickup:
        "Where should you be picked up? A place name, landmark or address works, such as Ferry Building, San Francisco.",
      destination:
        "Where are you going? Send a place name, landmark or address, such as SFO or Union Square, San Francisco.",
    };
    return { state, replies: [questions[missing]], cancel: cancelNeeded };
  }
  const vague = required.find(
    (k) =>
      locationFields.has(k) &&
      /^(here|near me|my location|current location|home|work)$/i.test(
        state.request[k]?.trim(),
      ),
  );
  if (vague) {
    state.awaiting = vague;
    state.phase = "clarifying";
    return {
      state,
      replies: [
        `What place or landmark do you mean by "${state.request[vague]}"? For example, Ferry Building, San Francisco. I cannot infer your location from a text message.`,
      ],
      cancel: cancelNeeded,
    };
  }
  state.awaiting = null;
  if (state.quotes.length && intent !== "refresh")
    return { state, replies: [recommendation(state, now)] };
  if (state.phase === "checking" && intent !== "refresh")
    return {
      state,
      replies: [
        "That comparison is already queued or running. Reply CANCEL to stop it.",
      ],
    };
  if (intent === "check" || intent === "refresh") {
    if (state.phase === "checking")
      return {
        state,
        replies: [
          "A comparison is already running. Reply CANCEL first if you need to restart.",
        ],
      };
    state.phase = "checking";
    state.revision++;
    state.quotes = [];
    return {
      state,
      replies: [
        `Checking ${state.mode === "food" ? "Uber Eats and DoorDash" : "Uber, Lyft and transit"} now. I will reply with results. No booking or order will be placed.`,
      ],
      job: {
        mode: state.mode,
        request: structuredClone(state.request),
        revision: state.revision,
      },
      cancel: cancelNeeded,
    };
  }
  state.phase = "ready";
  return {
    state,
    replies: [
      `I will compare: ${summary(state)}.${state.request.maxCents != null ? ` Budget ${money(state.request.maxCents)}.` : ""}${state.request.maxMinutes ? ` Within ${state.request.maxMinutes} minutes.` : ""}\nReply CHECK to start.${state.mode === "food" ? " This may prepare your basket in an empty cart; it will not place an order." : ""}`,
    ],
    cancel: cancelNeeded,
  };
}
export function completeComparison(previous, job, quotes, now = Date.now()) {
  if (
    previous.stopped ||
    previous.revision !== job.revision ||
    previous.phase !== "checking"
  )
    return null;
  const state = structuredClone(previous);
  state.quotes = quotes.map((q) => validateQuote(q, job.mode));
  const clarification = state.quotes.find(
    (q) => q.clarification,
  )?.clarification;
  if (clarification) {
    state.quotes = [];
    state.phase = "clarifying";
    state.awaiting = clarification.field;
    return {
      state,
      replies: [
        `I need to identify the right location before comparing prices: ${clarification.question}\nA city, neighborhood or nearby landmark is fine; a street address is optional.`,
      ],
    };
  }
  state.phase = "done";
  state.checkedAt = new Date(now).toISOString();
  return { state, replies: [recommendation(state, now)] };
}
export function exampleQuotes(mode, now = Date.now()) {
  const rows =
    mode === "food"
      ? [
          ["Uber Eats", 2875, 35, "$5 offer already applied"],
          ["DoorDash", 3220, 30, "Membership benefit already reflected"],
        ]
      : [
          ["Uber", 1840, 19, "Account offer already applied"],
          ["Lyft", 1590, 23, "No verified offer"],
          ["Transit", 300, 42, "Estimated fare"],
        ];
  return rows.map(([provider, totalCents, etaMinutes, offer]) =>
    validateQuote(
      {
        provider,
        totalCents,
        etaMinutes,
        offer,
        tipCents: mode === "food" ? 300 : null,
        basketConfirmed: true,
        stage: provider === "Transit" ? "estimate" : "checkout",
        source: "example",
        observedAt: new Date(now).toISOString(),
      },
      mode,
    ),
  );
}
