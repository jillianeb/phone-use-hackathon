import { providers, validateQuote, eligibility, rank, money } from "./core.mjs";
const $ = (s) => document.querySelector(s);
let mode = "food",
  quotes = { food: [], rides: [] },
  connected = false,
  running = false,
  currentJob = null;
const form = $("#request-form");
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const cents = (v) => (v === "" ? null : Math.round(Number(v) * 100));
function request() {
  const f = new FormData(form);
  return mode === "food"
    ? {
        restaurant: f.get("restaurant").trim(),
        basket: f.get("basket").trim(),
        address: f.get("address").trim(),
        tipCents: cents(f.get("tip")),
        maxMinutes: Number(f.get("foodTime")) || null,
      }
    : {
        pickup: f.get("pickup").trim(),
        destination: f.get("destination").trim(),
        maxMinutes: Number(f.get("rideTime")) || null,
      };
}
function notify(message) {
  $("#notice").innerHTML = message
    ? `<div class="notice">${escape(message)}</div>`
    : "";
}
function render() {
  $("#food-fields").hidden = mode !== "food";
  $("#rides-fields").hidden = mode !== "rides";
  for (const b of document.querySelectorAll("[data-mode]"))
    b.setAttribute("aria-selected", String(b.dataset.mode === mode));
  $("#results-title").textContent =
    mode === "food"
      ? "Same basket. Real totals."
      : "Same trip. Better options.";
  $(".method-note p").textContent =
    mode === "food"
      ? "We compare the displayed total, including tax, fees and the same tip. Applied offers are already in that total. Unverified coupons are never subtracted twice."
      : "Compare the same pickup and destination. Arrival time includes pickup, walking and waiting. Quotes change; refresh the selected option in the provider app before booking.";
  const qs = quotes[mode],
    r = rank(qs, mode, request());
  const examples = qs.some((q) => q.source === "example");
  $("#source-status").textContent = qs.length
    ? examples
      ? "EXAMPLE DATA"
      : `${qs.length} RECORDED QUOTE${qs.length > 1 ? "S" : ""}`
    : "NO QUOTES YET";
  $("#recommendation").innerHTML = r.cheapest
    ? `<div class="recommendation"><div class="eyebrow">${examples ? "EXAMPLE · " : ""}${r.count > 1 ? "LOWEST ELIGIBLE PRICE" : "ONE ELIGIBLE QUOTE"}</div><h3>${escape(r.cheapest.provider)}</h3><p>${r.count > 1 ? `${money(r.savings)} less than the highest eligible quote.` : "Add another eligible quote to compare savings."}${r.cheapest.etaMinutes != null ? ` Arrives in about ${r.cheapest.etaMinutes} min.` : ""}</p><div class="rec-price">${money(r.cheapest.totalCents)}</div></div>`
    : "";
  if (!qs.length) {
    $("#cards").innerHTML =
      `<div class="empty"><div class="empty-mark">↗</div><h3>Let’s compare your options.</h3><p>${mode === "food" ? "Start with one restaurant and one exact basket. Add Uber Eats and DoorDash checkout totals." : "Add Uber, Lyft and transit prices for the same route."}</p><button class="text-button" id="empty-add">+ Add your first quote</button></div>`;
    $("#empty-add").onclick = openQuote;
    return;
  }
  $("#cards").innerHTML = qs
    .map((q) => {
      const issue = eligibility(q, mode, request()),
        icon =
          q.provider === "DoorDash"
            ? "door"
            : q.provider === "Lyft"
              ? "lyft"
              : q.provider === "Transit"
                ? "transit"
                : "";
      const time = new Date(q.observedAt),
        age = (Date.now() - time.getTime()) / 60000;
      return `<article class="quote-card ${r.cheapest === q ? "best" : ""}"><div><div class="provider"><span class="provider-icon ${icon}">${escape(q.provider === "Uber Eats" ? "UE" : q.provider.slice(0, 1))}</span>${escape(q.provider)}</div><p class="subline">${q.etaMinutes == null ? "Arrival unknown" : `${q.etaMinutes} min total`}${r.fastest === q ? " · Fastest eligible" : ""}</p></div><div class="quote-price">${money(q.totalCents)}</div><div>${q.offer ? `<div class="offer">${escape(q.offer)}</div>` : ""}${issue ? `<p class="subline">↳ ${escape(issue)}</p>` : ""}${q.note ? `<p class="subline">${escape(q.note)}</p>` : ""}</div><div></div><div class="quote-meta"><span>${escape(q.source.toUpperCase())} · ${escape(time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}${age > 5 ? " · Refresh before choosing" : ""}</span><span>${q.stage === "checkout" ? "Final quote" : escape(q.stage)}</span>${q.evidenceDataUrl ? `<button class="text-button" data-evidence="${escape(q.provider)}">View screenshot ↗</button>` : "<span>No screenshot</span>"}${mode === "food" && !q.basketConfirmed ? `<button class="text-button" data-confirm="${escape(q.provider)}">Confirm basket match</button>` : ""}<button class="text-button remove" data-remove="${escape(q.provider)}">Remove</button></div></article>`;
    })
    .join("");
  for (const b of document.querySelectorAll("[data-remove]"))
    b.onclick = () => {
      quotes[mode] = qs.filter((q) => q.provider !== b.dataset.remove);
      render();
    };
  for (const b of document.querySelectorAll("[data-evidence]"))
    b.onclick = () => {
      $("#evidence-image").src = qs.find(
        (q) => q.provider === b.dataset.evidence,
      ).evidenceDataUrl;
      $("#evidence-dialog").showModal();
    };
  for (const b of document.querySelectorAll("[data-confirm]"))
    b.onclick = () => {
      if (
        confirm(
          "Confirm that this quote is for the same restaurant branch, exact items, sizes, modifiers, quantities and delivery address entered on the left.",
        )
      ) {
        qs.find((q) => q.provider === b.dataset.confirm).basketConfirmed = true;
        render();
      }
    };
}
function openQuote() {
  const f = $("#quote-form");
  f.reset();
  f.elements.provider.innerHTML = providers[mode]
    .map((p) => `<option>${p}</option>`)
    .join("");
  f.elements.tip.value =
    mode === "food" ? String(request().tipCents / 100) : "0";
  $("#quote-tip").hidden = mode !== "food";
  $("#basket-check").hidden = mode !== "food";
  $("#quote-error").textContent = "";
  $("#quote-dialog").showModal();
}
function add(q) {
  quotes[mode] = quotes[mode]
    .filter((x) => x.provider !== q.provider)
    .concat(q);
  render();
}
for (const b of document.querySelectorAll("[data-mode]"))
  b.onclick = () => {
    if (running) return;
    mode = b.dataset.mode;
    notify("");
    render();
  };
for (const b of document.querySelectorAll("[data-close]"))
  b.onclick = () => $("#" + b.dataset.close).close();
$("#add-quote").onclick = openQuote;
form.addEventListener("input", (event) => {
  if (["foodTime", "rideTime"].includes(event.target.name)) {
    render();
    return;
  }
  if (quotes[mode].length) {
    quotes[mode] = [];
    notify(
      "Comparison inputs changed. Previous quotes were cleared so different baskets or trips cannot be mixed.",
    );
    render();
  }
});
$("#quote-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target,
    d = new FormData(f);
  try {
    let evidenceDataUrl = null;
    const file = f.elements.evidence.files[0];
    if (file) {
      if (file.size > 4 * 1024 * 1024)
        throw Error("Choose a screenshot smaller than 4 MB.");
      evidenceDataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
    }
    const q = validateQuote(
      {
        provider: d.get("provider"),
        totalCents: cents(d.get("total")),
        etaMinutes: d.get("eta") === "" ? null : Number(d.get("eta")),
        tipCents: mode === "food" ? cents(d.get("tip")) : null,
        stage: d.get("stage"),
        basketConfirmed: d.has("basketConfirmed"),
        offer: d.get("offer"),
        note: d.get("note"),
        observedAt: new Date().toISOString(),
        source: "manual",
        evidenceDataUrl,
      },
      mode,
    );
    if (quotes[mode].some((x) => x.source === "example")) quotes[mode] = [];
    add(q);
    $("#quote-dialog").close();
    notify(
      "Quote recorded. Screenshots and results stay in this tab unless you export them.",
    );
  } catch (err) {
    $("#quote-error").textContent = err.message;
  }
};
$("#load-example").onclick = () => {
  const fields =
    mode === "food"
      ? {
          restaurant: "Example Burrito Kitchen · Market Street",
          basket: "2 × regular veggie burrito, no cheese",
          address: "Example delivery address, San Francisco",
          tip: "3",
          foodTime: "50",
        }
      : {
          pickup: "Example pickup, San Francisco",
          destination: "Example destination, San Francisco",
          rideTime: "45",
        };
  for (const [k, v] of Object.entries(fields)) form.elements[k].value = v;
  const data =
    mode === "food"
      ? [
          ["Uber Eats", 2875, 35, "Example: $5 promotion already applied"],
          [
            "DoorDash",
            3220,
            30,
            "Example: membership delivery benefit already applied",
          ],
        ]
      : [
          ["Uber", 1840, 19, "Example: account offer already applied"],
          ["Lyft", 1590, 23, "Example: no offer"],
          ["Transit", 300, 42, "Example: estimated fare"],
        ];
  quotes[mode] = data.map(([provider, totalCents, etaMinutes, offer]) =>
    validateQuote(
      {
        provider,
        totalCents,
        etaMinutes,
        offer,
        stage: provider === "Transit" ? "estimate" : "checkout",
        basketConfirmed: true,
        tipCents: mode === "food" ? 300 : null,
        source: "example",
        observedAt: new Date().toISOString(),
      },
      mode,
    ),
  );
  notify(
    "EXAMPLE DATA — these are invented demonstration prices, not live provider quotes.",
  );
  render();
};
$("#clear").onclick = () => {
  quotes[mode] = [];
  notify("");
  render();
};
$("#export").onclick = () => {
  const blob = new Blob(
      [
        JSON.stringify(
          { mode, request: request(), quotes: quotes[mode] },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `fareplay-${mode}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};
$("#import").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024)
      throw Error("Import is limited to 12 MB.");
    const data = JSON.parse(await file.text());
    if (
      !["food", "rides"].includes(data.mode) ||
      !Array.isArray(data.quotes) ||
      data.quotes.length > 3
    )
      throw Error("Use an exported Fareplay JSON result.");
    const imported = data.quotes.map((q) =>
      validateQuote(
        { ...q, source: q.source === "example" ? "example" : "imported" },
        data.mode,
      ),
    );
    if (new Set(imported.map((q) => q.provider)).size !== imported.length)
      throw Error("One quote per provider is allowed.");
    const req = data.request;
    if (!req || typeof req !== "object")
      throw Error("Missing comparison request");
    if (
      data.mode === "food" &&
      (!Number.isSafeInteger(req.tipCents) || req.tipCents < 0)
    )
      throw Error("Invalid comparison tip");
    mode = data.mode;
    quotes[mode] = imported;
    const fields =
      mode === "food"
        ? {
            restaurant: req.restaurant || "",
            basket: req.basket || "",
            address: req.address || "",
            tip: String(req.tipCents / 100),
            foodTime: String(req.maxMinutes || ""),
          }
        : {
            pickup: req.pickup || "",
            destination: req.destination || "",
            rideTime: String(req.maxMinutes || ""),
          };
    for (const [k, v] of Object.entries(fields)) form.elements[k].value = v;
    notify(
      "Imported quotes. Review timestamps and evidence; these have not been refreshed.",
    );
    render();
  } catch (err) {
    notify("Import failed: " + err.message);
  } finally {
    e.target.value = "";
  }
};
$("#setup").onclick = () => {
  $("#setup-status").textContent = connected
    ? "Local collector is configured. Apps must already be installed and signed in."
    : "No configured local collector detected. You can add quotes, attach screenshots, or load the example now.";
  $("#setup-dialog").showModal();
};
const token = $('meta[name="local-token"]').content;
async function api(path, opts = {}) {
  const response = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-Fareplay-Token": token,
      ...opts.headers,
    },
  });
  if (!response.ok)
    throw Error(
      (await response.json().catch(() => ({}))).error ||
        `Request failed (${response.status})`,
    );
  return response.json();
}
async function poll() {
  try {
    const job = await api("/api/jobs/" + currentJob);
    $("#activity").textContent = job.events.join("\n");
    if (job.state === "running") {
      setTimeout(poll, 1500);
      return;
    }
    quotes[mode] = job.quotes.map((q) => validateQuote(q, mode));
    running = false;
    $("#compare").disabled = false;
    form
      .querySelectorAll("input,textarea")
      .forEach((el) => (el.disabled = false));
    $("#compare").innerHTML = "Check my apps <span>↗</span>";
    notify(
      job.state === "failed"
        ? "Collection stopped. " + job.error
        : "Collection finished. Review evidence and confirm food basket matches before comparing.",
    );
    render();
  } catch (err) {
    running = false;
    $("#compare").disabled = false;
    form
      .querySelectorAll("input,textarea")
      .forEach((el) => (el.disabled = false));
    notify("Could not read collection progress: " + err.message);
  }
}
form.onsubmit = async (e) => {
  e.preventDefault();
  if (!connected) {
    $("#setup").click();
    return;
  }
  const req = request();
  if (mode === "food" && (!req.restaurant || !req.basket || !req.address)) {
    notify("Enter a restaurant branch, exact basket and delivery address.");
    return;
  }
  if (mode === "rides" && (!req.pickup || !req.destination)) {
    notify("Enter exact pickup and destination addresses.");
    return;
  }
  try {
    const job = await api("/api/compare", {
      method: "POST",
      body: JSON.stringify({ mode, request: req }),
    });
    currentJob = job.id;
    running = true;
    quotes[mode] = [];
    $("#compare").disabled = true;
    form
      .querySelectorAll("input,textarea")
      .forEach((el) => (el.disabled = true));
    $("#compare").textContent = "Checking apps…";
    $("#activity").hidden = false;
    $("#activity").textContent = "Starting sequential provider checks…";
    notify(
      "Keep the controlled phone visible. No booking or order should be submitted.",
    );
    render();
    poll();
  } catch (err) {
    notify(err.message);
  }
};
render();
if (token !== "__LOCAL_TOKEN__")
  api("/api/status")
    .then((s) => {
      connected = s.configured;
      $("#connection-dot").textContent = connected ? "●" : "○";
      $("#request-help").textContent = s.configured
        ? "Local collector configured. Phone access has not been verified."
        : "Local server running. Add PhoneUse and model credentials to enable checks.";
    })
    .catch(() => {});
