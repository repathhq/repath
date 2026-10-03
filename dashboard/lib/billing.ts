/** Shapes returned by /api/billing/razorpay/details. */

export type PaymentMethod = {
  method: string;
  label: string;
  /** Razorpay lets a card-authorised mandate switch card in checkout. */
  changeable: boolean;
};

export type BillingDetails = {
  /** Razorpay publishable key, for opening checkout to change the card. */
  key_id: string | null;
  subscription: { id: string; status: string; charge_at: string | null; current_end: string | null; payment_method: string | null } | null;
  payment_method: PaymentMethod | null;
  invoices: Array<{
    id: string;
    status: string;
    amount_minor: number;
    currency: string;
    date: string | null;
    period_start: string | null;
    period_end: string | null;
    receipt_url: string | null;
  }>;
};
