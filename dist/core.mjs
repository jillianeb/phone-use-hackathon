export const providers = {
  food: ["Uber Eats", "DoorDash"],
  rides: ["Uber", "Lyft", "Transit"],
};
export function validateQuote(q, mode) {
  if (!q || typeof q !== "object" || !providers[mode]?.includes(q.provider))
    throw Error("Unknown provider");
  for (const key of ["totalCents", "etaMinutes", "tipCents"]) {
    if (
      q[key] != null &&
      (!Number.isSafeInteger(q[key]) || q[key] < 0 || q[key] > 10000000)
    )
      throw Error(`Invalid ${key}`);
  }
  if (!["checkout", "estimate", "unavailable"].includes(q.stage))
    throw Error("Invalid quote stage");
  if (!Number.isFinite(Date.parse(q.observedAt)))
    throw Error("Quote needs a valid timestamp");
  if (q.basketConfirmed != null && typeof q.basketConfirmed !== "boolean")
    throw Error("Invalid basket confirmation");
  if (
    q.evidenceDataUrl &&
    !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(
      q.evidenceDataUrl,
    )
  )
    throw Error("Evidence must be a PNG, JPEG, or WebP image");
  for (const key of ["offer", "note"])
    if (q[key] != null && (typeof q[key] !== "string" || q[key].length > 3000))
      throw Error(`Invalid ${key}`);
  return {
    provider: q.provider,
    totalCents: q.totalCents ?? null,
    etaMinutes: q.etaMinutes ?? null,
    tipCents: q.tipCents ?? null,
    stage: q.stage,
    basketConfirmed: q.basketConfirmed === true,
    observedAt: q.observedAt,
    offer: q.offer || "",
    note: q.note || "",
    evidenceDataUrl: q.evidenceDataUrl || null,
    source: ["example", "live", "manual", "imported"].includes(q.source)
      ? q.source
      : "imported",
  };
}
export function eligibility(q, mode, request) {
  if (q.stage === "unavailable" || q.totalCents == null)
    return "Price unavailable";
  if (mode === "food" && q.stage !== "checkout") return "Checkout total needed";
  if (mode === "food" && !q.basketConfirmed)
    return "Confirm the same branch and basket";
  if (mode === "food" && q.tipCents !== request.tipCents)
    return "Tip differs from comparison";
  if (
    request.maxMinutes &&
    (q.etaMinutes == null || q.etaMinutes > request.maxMinutes)
  )
    return q.etaMinutes == null
      ? "Arrival time unknown"
      : "Outside your time limit";
  return null;
}
export function rank(quotes, mode, request) {
  const eligible = quotes.filter((q) => !eligibility(q, mode, request));
  const cheapest =
    [...eligible].sort((a, b) => a.totalCents - b.totalCents)[0] || null;
  const fastest =
    [...eligible]
      .filter((q) => q.etaMinutes != null)
      .sort((a, b) => a.etaMinutes - b.etaMinutes)[0] || null;
  const sorted = [...eligible].sort((a, b) => a.totalCents - b.totalCents);
  return {
    cheapest,
    fastest,
    savings:
      sorted.length > 1 ? sorted.at(-1).totalCents - sorted[0].totalCents : 0,
    count: eligible.length,
  };
}
export const money = (c) =>
  c == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(c / 100);
