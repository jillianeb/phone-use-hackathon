import {
  reduceConversation,
  completeComparison,
} from "../dist/conversation.mjs";
import { interpretText } from "./planner.mjs";
import { collectComparison } from "../collector.mjs";
export class SMSService {
  constructor({
    store,
    bindings,
    send,
    env = process.env,
    collect = collectComparison,
    interpret = interpretText,
    publicBase = "",
  }) {
    Object.assign(this, {
      store,
      bindings,
      send,
      env,
      collect,
      interpret,
      publicBase,
    });
    this.planning = false;
    this.sending = false;
    this.running = null;
    this.stopping = false;
    this.lastPrune = 0;
  }
  async processInbound() {
    if (this.planning || this.stopping) return;
    const row = this.store.nextInbound();
    if (!row) return;
    this.planning = true;
    try {
      const state = this.store.get(row.sender);
      let plan;
      if (state.stopped && row.body.trim().toUpperCase() !== "START") {
        this.store.inboundDone(row.sid, "ignored");
        return;
      }
      try {
        const parsed = await this.interpret(row.body, state, this.env);
        plan = reduceConversation(state, parsed);
      } catch {
        plan = {
          state,
          replies: [
            "I could not interpret that request. Please try a shorter message, or reply HELP for the food and ride formats.",
          ],
        };
      }
      this.store.applyTurn(row, state.revision, plan);
    } finally {
      this.planning = false;
    }
  }
  startJob() {
    if (this.running || this.stopping) return;
    const job = this.store.claimJob();
    if (!job) return;
    const controller = new AbortController();
    this.running = { job, controller };
    const deviceId = this.bindings[job.sender];
    if (!deviceId) {
      this.store.failJob(job);
      this.running = null;
      return;
    }
    this.collect({
      mode: job.payload.mode,
      request: job.payload.request,
      signal: controller.signal,
      env: { ...this.env, PHONEUSE_DEVICE_ID: deviceId },
      onEvent: () => {
        if (this.store.activeJob(job.id)?.state !== "running")
          controller.abort();
      },
    })
      .then((quotes) => {
        if (controller.signal.aborted) return;
        const current = this.store.get(job.sender),
          result = completeComparison(current, job.payload, quotes);
        if (result && this.store.activeJob(job.id)?.state === "running") {
          const links = [];
          for (const quote of result.state.quotes) {
            if (quote.evidenceDataUrl) {
              const key = this.store.evidence(
                job.sender,
                quote.evidenceDataUrl,
              );
              links.push(
                `${quote.provider}: ${this.publicBase}/evidence/${key}`,
              );
              delete quote.evidenceDataUrl;
            }
          }
          if (links.length)
            result.replies.push(
              "Private evidence links expire in 15 minutes. Review the basket and totals before replying MATCH.\n" +
                links.join("\n"),
            );
          this.store.completeJob(job, result);
        }
      })
      .catch(() => {
        this.store.failJob(job);
      })
      .finally(() => {
        this.running = null;
      });
  }
  async flushOutbound() {
    if (this.sending || this.stopping) return;
    const row = this.store.claimOutbound();
    if (!row) return;
    this.sending = true;
    try {
      const message = await this.send({ to: row.sender, body: row.body });
      this.store.sent(row.id, message.sid);
    } catch {
      this.store.uncertain(
        row.id,
      ); /* Delivery may have happened. No automatic resend. */
    } finally {
      this.sending = false;
    }
  }
  tick() {
    if (this.stopping) return;
    if (
      this.running &&
      this.store.activeJob(this.running.job.id)?.state !== "running"
    )
      this.running.controller.abort();
    void this.processInbound().catch(() => {});
    this.startJob();
    void this.flushOutbound().catch(() => {});
    if (Date.now() - this.lastPrune > 60000) {
      this.store.prune();
      this.lastPrune = Date.now();
    }
  }
  stop() {
    this.stopping = true;
    this.running?.controller.abort();
  }
}
