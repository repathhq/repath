/**
 * Plan catalogue.
 *
 * Prices and quotas live here so the checkout route, the billing page and the
 * gateway cannot drift apart. Razorpay plan ids are not secrets — they are
 * sent to the browser to open checkout — so they are committed rather than
 * held in environment variables, which keeps "which plan is this?" answerable
 * from the code alone.
 *
 * Quotas are mirrored in `plan_quota` in crates/gateway/src/api/cloud.rs; the
 * gateway is authoritative, since it is what actually enforces them.
 */

export type PlanId = "indie" | "starter" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  /** Razorpay plan id backing the recurring subscription. */
  razorpayPlanId: string;
  /** Price in paise. The provider's own integer — never a float. */
  amountMinor: number;
  evaluations: number;
}

export const PLANS: Record<PlanId, Plan> = {
  indie: {
    id: "indie",
    name: "Indie",
    razorpayPlanId: "plan_TVVWYHISVkBolC",
    amountMinor: 169_900,
    evaluations: 3_000,
  },
  starter: {
    id: "starter",
    name: "Starter",
    razorpayPlanId: "plan_TVVWYSxAUyDgGG",
    amountMinor: 409_900,
    evaluations: 10_000,
  },
  pro: {
    id: "pro",
    name: "Pro",
    razorpayPlanId: "plan_TVVWYdCz0n00zi",
    amountMinor: 1_249_900,
    evaluations: 100_000,
  },
};

/**
 * A ₹1/month plan used only with the internal test coupon.
 *
 * It is a real subscription rather than a discounted one-off, so redeeming the
 * coupon exercises the exact code path a paying customer takes — mandate,
 * authorisation, renewal — for one rupee. A discounted Order would test the
 * checkout modal and nothing else.
 */
export const INTERNAL_TEST_PLAN_ID = "plan_TVVWYncmISgVl9";

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && value in PLANS;
}
