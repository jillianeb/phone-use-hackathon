# Activate Android SMS

No APK is required. Your test user sends normal text messages to a Twilio number. The backend then talks to a separately configured PhoneUse device. An Android texting client does not automatically connect its installed apps to PhoneUse.

## 1. Get the external accounts ready

- Obtain an SMS-capable Twilio number and confirm that your account/number is enabled to send to the test handset. Trial, verification, sender-registration or country restrictions may affect readiness; use the Twilio console to verify this before the demo.
- Obtain a working PhoneUse device. Have the user sign into their provider apps manually.
- Obtain an Anthropic API key and an accessible model ID supporting images and tools. A chat subscription alone is not the API credential.

No SMS number, model credit or PhoneUse credit is included or promised by this repository.

## 2. Configure the service privately

From the project root, run `npm ci`, copy `.env.example` to `.env`, and fill:

| Variable | Value |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Your Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Your Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Your SMS number in +countrycode format |
| `SMS_PUBLIC_BASE_URL` | Public HTTPS origin reaching this Node service |
| `SMS_BINDINGS_JSON` | JSON mapping each allowed user's phone number to their dedicated PhoneUse device ID |
| `PHONEUSE_API_KEY` | Hosted PhoneUse key; use `PHONEUSE_MCP_COMMAND` for the local repo instead |
| `ANTHROPIC_API_KEY` | Model API key |
| `ANTHROPIC_MODEL` | Model ID available to your account |

Example binding syntax, with invented placeholders:

```dotenv
SMS_BINDINGS_JSON={"+15551234567":"replace-with-that-users-device-id"}
```

Each sender must have a distinct dedicated device/session. Use one test sender and one device for the fastest reliable demo. The service rejects unbound senders. Do not bind strangers to a device signed into someone else's accounts.

`.env` and `.state/` are ignored by Git. Keep credentials out of messages, browser forms, issue reports and screenshots.

## 3. Run and expose the SMS service

```sh
npm run sms
```

By default this listens on `127.0.0.1:3111`. Use an HTTPS tunnel to that port for a laptop demo, or deploy the supplied Dockerfile to a Node-capable host with a persistent disk. Set `SMS_PUBLIC_BASE_URL` to the exact HTTPS origin. Restart after changing environment values.

The owner-private static Sites preview is NOT the SMS webhook host. Its authentication and static deployment cannot receive these webhooks. Do not configure Twilio with the chat preview URL.

For Docker:

```sh
docker build -t fareplay-sms .
docker run --env-file .env -p 8080:8080 -v fareplay-state:/app/.state fareplay-sms
```

For this command, set `SMS_PORT=8080`, `SMS_BIND_HOST=0.0.0.0` and `SMS_STATE_DIR=/app/.state` in the supplied environment; values in `.env` override the image defaults. Terminate HTTPS at your host or reverse proxy. Only the signed Twilio webhooks, minimal health route and expiring evidence links are public. Run one instance. The Docker image has been provided but not built in the original development session.

A localhost stdio PhoneUse command can run alongside the SMS service on a laptop. It cannot reach that laptop from a remote container without a separately designed authenticated worker connection. For the quickest remote deployment use hosted PhoneUse; for a local connected iPhone use the laptop/tunnel arrangement.

## 4. Configure your Twilio number

Set the incoming-message webhook to:

```text
POST https://YOUR-HOST/webhooks/twilio/sms
```

The service sets this status callback for outgoing messages:

```text
POST https://YOUR-HOST/webhooks/twilio/status
```

Use the exact origin configured in `SMS_PUBLIC_BASE_URL`, with no path prefix, query string or extra trailing slash in either route. Signature verification uses this canonical URL instead of trusting proxy headers. Configure provider opt-out behavior; the application handles STOP/START and the provider's `OptOutType` when present. CANCEL without provider opt-out metadata cancels a task; provider-level opt-out always takes precedence.

`GET /health` reports `smsConfigured`. This checks configuration only, not actual app login, credits or SMS deliverability.

## 5. Test the real loop

1. From the bound Android phone, text HELP. Confirm one reply.
2. Send a complete food request with an explicit branch, basket, address, dollar tip, budget and deadline.
3. Verify the summary, then reply CHECK. Watch the controlled phone. No order should be placed.
4. Review provisional totals and evidence links. Confirm basket matching with MATCH only after inspecting them.
5. Change the budget/time limit, then test a ride request.
6. Test CANCEL during a check and STOP/START. Actions or messages already dispatched may still complete.

If delivery fails ambiguously, inspect the Twilio console before resending. The service records `uncertain` instead of automatically duplicating a possible successful send. Records are in the private SQLite database; the public service does not expose an admin console.

## What is verified

Automated tests verify the signed-webhook pipeline and background service with simulated providers. Actual handset SMS, provider credentials, device pairing and navigation through Uber/Lyft/Uber Eats/DoorDash were unavailable during development and remain to be validated.
