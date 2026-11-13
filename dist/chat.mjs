import {
  newConversation,
  simpleInterpret,
  reduceConversation,
  completeComparison,
  exampleQuotes,
} from "./conversation.mjs";
const $ = (s) => document.querySelector(s);
let state = newConversation(),
  messages = [],
  pending = null;
try {
  const saved = JSON.parse(
    sessionStorage.getItem("fareplay-chat-demo") || "null",
  );
  if (saved?.state?.version === 1 && Array.isArray(saved.messages)) {
    state = saved.state;
    messages = saved.messages.slice(-80);
    if (state.phase === "checking") {
      state.phase = "ready";
      messages.push({
        role: "system",
        text: "The demo check was interrupted. Reply CHECK to restart it.",
        time: Date.now(),
      });
    }
  }
} catch {}
function save() {
  try {
    sessionStorage.setItem(
      "fareplay-chat-demo",
      JSON.stringify({ state, messages: messages.slice(-80) }),
    );
  } catch {}
}
function render() {
  const log = $("#messages");
  log.replaceChildren();
  const day = document.createElement("div");
  day.className = "day";
  day.textContent = "FAREPLAY · DEMO CONVERSATION";
  log.append(day);
  for (const m of messages) {
    const el = document.createElement("div");
    el.className = "message " + m.role;
    el.textContent = m.text;
    const time = document.createElement("time");
    time.textContent = new Date(m.time).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    el.append(time);
    log.append(el);
  }
  log.scrollTop = log.scrollHeight;
  if (state.phase === "done") {
    const prompts = [
      ["Within 30 minutes", "Within 30 minutes"],
      ["Under $25", "Under $25"],
      ["Why this option?", "why"],
      ["New request", "new"],
    ];
    $("#suggestions").replaceChildren();
    for (const [label, value] of prompts) {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = () => receive(value);
      $("#suggestions").append(b);
    }
  }
  save();
}
function append(role, text) {
  messages.push({ role, text, time: Date.now() });
  if (messages.length > 80) messages.shift();
  render();
}
if (!messages.length)
  append(
    "agent",
    "Hey, I’m Fareplay. Tell me what you need to eat or where you need to go. I’ll compare options around your budget and time.\n\nThis is a demo: prices are invented. Real SMS and phone checks are not connected.",
  );
else render();
function receive(text) {
  append("user", text);
  let plan;
  try {
    plan = reduceConversation(state, simpleInterpret(text, state));
  } catch {
    append(
      "agent",
      "I couldn’t use that detail. Send a budget in dollars or an arrival limit in minutes.",
    );
    return;
  }
  if (plan.cancel && pending) {
    clearTimeout(pending);
    pending = null;
    $("#typing").hidden = true;
  }
  state = plan.state;
  for (const reply of plan.replies) append("agent", reply);
  if (state.stopped)
    append("system", "Replies stopped in this demo. Text START to resume.");
  if (plan.job) {
    $("#typing").hidden = false;
    const job = plan.job;
    pending = setTimeout(() => {
      pending = null;
      $("#typing").hidden = true;
      const quotes = exampleQuotes(job.mode);
      if (job.mode === "food")
        for (const q of quotes) {
          q.totalCents += job.request.tipCents - 300;
          q.tipCents = job.request.tipCents;
        }
      const result = completeComparison(state, job, quotes);
      if (result) {
        state = result.state;
        for (const reply of result.replies) append("agent", reply);
      }
      save();
    }, 900);
  }
  save();
}
$("#compose").onsubmit = (e) => {
  e.preventDefault();
  const input = $("#message"),
    text = input.value.trim();
  if (!text) return;
  input.value = "";
  input.style.height = "";
  receive(text);
};
$("#message").oninput = (e) => {
  e.target.style.height = "auto";
  e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
};
$("#message").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("#compose").requestSubmit();
  }
};
const starters = {
  food: "Compare 2 veggie burritos from Example Burrito Kitchen, Market St; deliver to 456 Example St; tip $3; under $35; within 45 minutes.",
  rides:
    "Compare a ride from 123 Example St to 789 Demo Ave; under $25; within 45 minutes.",
  help: "help",
};
for (const b of document.querySelectorAll("[data-prompt]"))
  b.onclick = () => receive(starters[b.dataset.prompt]);
$("#reset").onclick = () => {
  if (pending) clearTimeout(pending);
  pending = null;
  state = newConversation();
  messages = [];
  $("#typing").hidden = true;
  append(
    "agent",
    "Fresh conversation. Tell me your food basket or trip. This preview uses invented prices; real SMS is not connected.",
  );
};
$("#about").onclick = () => $("#about-dialog").showModal();
$("#close-about").onclick = () => $("#about-dialog").close();
