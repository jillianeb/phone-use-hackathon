# Fareplay

Text what you need. Compare food delivery and rides around your budget, arrival time and applied offers.

Users text a dedicated SMS number from Android's normal Messages app. A conversation engine gathers missing details, asks for CHECK before phone work, and uses PhoneUse to inspect provider apps. Price ranking uses deterministic rules, not model-generated scores.

## Current status

- **Browser demo:** working mobile conversation with invented, clearly labeled prices. Food, rides, follow-ups, budget/deadline changes, reset and stop/start are available. Its parser is deliberately limited; it does not send SMS or control devices.
- **SMS service:** implemented with the official Twilio SDK, signed webhooks, SQLite conversation memory, durable inbox/jobs/outbox, asynchronous phone work and delivery callbacks. Tested with mocks and signed local HTTP requests. No SMS number or credentials were supplied, so actual Android SMS delivery is not activated or verified.
- **Phone collector:** implemented for hosted PhoneUse HTTP MCP and the original local iPhone repo's stdio MCP. No working device was supplied; live app navigation remains unverified.
- **Original quote interface:** retained at `/compare.html`, including manual screenshots and JSON import/export.
- **Purchasing:** not supported. The agent is instructed to stop before a transaction; supervise phone runs because a prompt is not a hard payment sandbox. Food preparation may add the requested items to an empty cart.

## Run the browser demo

Requires Node 24+ and npm.

```sh
npm ci
npm start
```

Open http://127.0.0.1:3110. Start with **Compare my dinner**, then send **CHECK**, then **Within 30 minutes**. All resulting prices are examples. The hosted private Site also serves this static demo; it does not run the SMS backend.

## Run real SMS

Read [SMS setup](docs/SMS_SETUP.md). Prepare an SMS-capable Twilio number, an approved test sender, a dedicated PhoneUse device/session signed into that user's apps, and an Anthropic API key/model with image and tool support.

```sh
cp .env.example .env
# Fill the required values privately in .env.
npm run sms
```

The service listens on loopback port 3111 by default. It needs a public HTTPS origin for Twilio to reach it. The number and credentials are not provisioned by this code. The browser demo and SMS service are separate entry points.

## Conversation

```text
You: Compare 2 veggie burritos from Chipotle near Moscone Center;
     deliver to Moscone Center, San Francisco; tip $3; under $35.
Agent: [Checks details.] Reply CHECK to start.
You: CHECK
Agent: Checking Uber Eats and DoorDash...
Agent: [Observed totals, applied offers and arrival times.]
You: Within 30 minutes.
Agent: [Reranks qualifying recent quotes.]
```

Food results stay provisional until the user reviews the basket evidence and replies MATCH. Applied offers remain inside the displayed total and are never deducted twice. Changing the basket, address or tip invalidates old quotes. Budget/time-only follow-ups can reuse recent quotes. Live quotes older than five minutes prompt a refresh.

Commands: HELP, CHECK, REFRESH, WHY, FASTEST, STATUS, MATCH, CANCEL, NEW, STOP, START. Natural language is interpreted through the configured model in the SMS service. Users should complete login and verification directly in provider apps.

Location inputs accept place names, airports, hotels, landmarks and natural descriptions. Try “Get me to SFO,” then answer the pickup question with “Ferry Building, San Francisco.” Street addresses are optional. The collector searches names in provider apps and asks for a city, branch or landmark if there are multiple plausible results. It never assumes the cloud phone's GPS is your location. Inputs such as “here” or an unsaved “home” need clarification. Provider-side place matching remains unverified until a working phone is connected.

## Engineering choices

- One active phone job at a time; no concurrent agents tapping the same device.
- Explicit sender-to-device bindings; duplicate device assignment is rejected. Device discovery is filtered to the assigned device before reaching the model.
- Twilio signatures verified using the official SDK and a configured canonical HTTPS URL. No public administration or arbitrary phone-control endpoint.
- Unique inbound message IDs prevent duplicate webhooks from generating duplicate work.
- Atomic SQLite transactions store conversation changes, jobs and replies together.
- Revisions prevent cancelled or replaced jobs from sending stale recommendations.
- STOP immediately cancels queued work and pending replies. An action or SMS already dispatched can still finish.
- Interrupted running phone jobs require an explicit refresh after restart. Ambiguous outbound SMS failures are marked uncertain and are not blindly resent.
- Screenshot evidence uses unguessable links that expire after 15 minutes. Local records are private files; completed message/job records are pruned after a day and idle conversations after seven days.

This is a single-process hackathon service. Run one instance against one persistent SQLite volume. It is not a horizontally scaled multi-tenant production deployment. The database is not encrypted at rest by the application; protect the disk. Twilio, PhoneUse and the model provider may retain data under their own policies. Screen content and task details are sent to the model during live checks.

## Project map

| File | Responsibility |
| --- | --- |
| `dist/index.html`, `chat.mjs`, `chat.css` | Android-friendly conversation demo |
| `dist/conversation.mjs` | Shared request state, follow-up rules and text recommendations |
| `dist/core.mjs` | Quote validation, eligibility and ranking |
| `sms-server.mjs` | SMS webhooks, signature verification and evidence delivery |
| `sms/store.mjs` | Persistent sessions, inbox, queue and outbox |
| `sms/service.mjs` | Background interpretation, device collection and replies |
| `sms/planner.mjs` | Model-assisted request extraction |
| `collector.mjs` | Bounded model/PhoneUse control loop |
| `server.mjs` | Local browser demo and original comparison backend |
| `Dockerfile` | Container entry point for the SMS service |

## Checks

```sh
npm test
```

Tests cover normalization, ranking, discounts, deadlines, conversation state, cancellation, restart recovery, data isolation, signature verification, duplicate webhook delivery and uncertain SMS sends. Device/model/SMS network calls are mocked. Live app navigation and real SMS delivery require an end-to-end test after activation.

## References

- [PhoneUse quickstart](https://docs.phoneuse.com/quickstart)
- [Local iPhone repository](https://github.com/phoneuse-official/phoneuse)
- [Twilio receive/reply documentation](https://www.twilio.com/docs/messaging/tutorials/how-to-receive-and-reply/node-js)
- [Twilio webhook verification](https://www.twilio.com/docs/usage/webhooks/webhooks-security)

No credentials, pairing/signing files, real device inventory, task histories or provider screenshots belong in this repository.
