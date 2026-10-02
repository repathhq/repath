//! Per-request cost estimation.
//!
//! # Why estimate at all
//!
//! The log has to answer "what did this cost". Providers do not return a cost
//! on the response, so it has to be derived from the token counts they do
//! return. Doing that in the gateway rather than the dashboard means one
//! implementation, and a number that stays correct in exports and totals
//! rather than only where someone remembered to divide.
//!
//! # Integers, not floats
//!
//! Costs are stored in millionths of a dollar. A per-request cost is often
//! around 0.0002 USD; summing millions of f64s at that magnitude accumulates
//! visible error, and "your bill is 4,281.9999999" is not a number to show
//! anyone. Integer micro-dollars sum exactly.
//!
//! # These prices go stale
//!
//! Provider pricing changes and this table will drift. It is deliberately a
//! small, obvious list rather than a config file: an unknown model returns
//! `None` and the UI shows "—" instead of a confidently wrong figure. A
//! missing price is honest; a stale one is not.

/// A list price, given in US cents per million tokens, as micro-dollars per
/// million tokens — the unit the arithmetic below needs.
///
/// Writing prices in cents keeps the table readable against the providers'
/// own pages ($0.15 → `c(15)`). The previous table wrote `150` for gpt-4o-mini
/// while the arithmetic treated it as micro-dollars, so every cost in the
/// request log read 1,000x too low: a $0.75 request showed as $0.00075.
const fn c(cents_per_million: u64) -> u64 {
    cents_per_million * 10_000
}

/// (model, input, output) list prices per million tokens, standard tier.
///
/// Checked against each provider's pricing page on 2026-10-02. Retired models
/// stay listed so request-log rows written while they were live keep their
/// cost; they can no longer be called, so they price nothing new.
///
/// Matching is by name boundary, not raw prefix: `gpt-4o-mini-2024-07-18`
/// resolves to `gpt-4o-mini`, but `gpt-5.7-x` does not resolve to `gpt-5` —
/// an unknown version gets "—", not a confident guess.
const PRICES: &[(&str, u64, u64)] = &[
    // ── OpenAI ─────────────────────────────────────────────────────────────
    ("gpt-6-astra", c(1_000), c(5_000)),
    ("gpt-6.1-sol", c(200), c(1_000)),
    ("gpt-6-sol", c(200), c(1_000)),
    ("gpt-6-luna", c(10), c(50)),
    ("gpt-5.6-sol", c(400), c(2_000)),
    ("gpt-5.6-terra", c(200), c(1_200)),
    ("gpt-5.6-luna", c(20), c(120)),
    ("gpt-5.5-pro", c(3_000), c(18_000)),
    ("gpt-5.5", c(500), c(3_000)),
    ("gpt-5.4-pro", c(3_000), c(18_000)),
    ("gpt-5.4-mini", c(75), c(450)),
    ("gpt-5.4-nano", c(20), c(125)),
    ("gpt-5.4", c(250), c(1_500)),
    ("gpt-5.3-codex", c(175), c(1_400)),
    ("gpt-5.2-pro", c(2_100), c(16_800)),
    ("gpt-5.2", c(175), c(1_400)),
    ("gpt-5.1", c(125), c(1_000)),
    ("gpt-5-pro", c(1_500), c(12_000)),
    ("gpt-5-mini", c(25), c(200)),
    ("gpt-5-nano", c(5), c(40)),
    ("gpt-5", c(125), c(1_000)),
    ("gpt-4.1-mini", c(40), c(160)),
    ("gpt-4.1-nano", c(10), c(40)), // shuts down 2026-10-23
    ("gpt-4.1", c(200), c(800)),
    ("gpt-4o-mini", c(15), c(60)),
    ("gpt-4o-2024-05-13", c(500), c(1_500)),
    ("gpt-4o", c(250), c(1_000)),
    ("o4-mini", c(110), c(440)),
    ("o3-pro", c(2_000), c(8_000)),
    ("o3-mini", c(110), c(440)), // shuts down 2026-10-23
    ("o3", c(200), c(800)),
    ("o1-pro", c(15_000), c(60_000)),
    ("o1-mini", c(110), c(440)),         // retired 2025-10-27
    ("o1", c(1_500), c(6_000)),          // shuts down 2026-10-23
    ("gpt-4-turbo", c(1_000), c(3_000)), // shuts down 2026-10-23
    ("gpt-4", c(3_000), c(6_000)),       // shuts down 2026-10-23
    ("gpt-3.5-turbo", c(50), c(150)),    // shuts down 2026-10-23
    // ── Anthropic ──────────────────────────────────────────────────────────
    ("claude-fable-5-1", c(1_000), c(5_000)),
    ("claude-fable-5", c(1_000), c(5_000)),
    ("claude-opus-5-5", c(400), c(2_000)),
    ("claude-opus-5", c(500), c(2_500)),
    ("claude-opus-4-8", c(500), c(2_500)),
    ("claude-opus-4-7", c(500), c(2_500)),
    ("claude-opus-4-6", c(500), c(2_500)),
    ("claude-opus-4-5", c(500), c(2_500)),
    ("claude-opus-4-1", c(1_500), c(7_500)), // retired 2026-08-05
    ("claude-opus-4", c(1_500), c(7_500)),   // deprecated
    ("claude-sonnet-5-5", c(200), c(1_000)),
    ("claude-sonnet-5", c(200), c(1_000)),
    ("claude-sonnet-4-6", c(300), c(1_500)),
    ("claude-sonnet-4-5", c(300), c(1_500)),
    ("claude-sonnet-4", c(300), c(1_500)), // deprecated
    ("claude-haiku-4-5", c(100), c(500)),
    ("claude-3-7-sonnet", c(300), c(1_500)), // retired
    ("claude-3-5-sonnet", c(300), c(1_500)), // retired
    ("claude-3-5-haiku", c(80), c(400)),     // retired
    ("claude-3-opus", c(1_500), c(7_500)),   // retired
    ("claude-3-haiku", c(25), c(125)),       // deprecated
    // ── Google ─────────────────────────────────────────────────────────────
    // The 3.6–3.8 Flash prices are Google's promotional rate through
    // 2026-12-31; revisit this table in January.
    ("gemini-3.8-flash", c(75), c(375)),
    ("gemini-3.7-flash", c(75), c(375)),
    ("gemini-3.6-flash", c(75), c(375)),
    ("gemini-3.5-flash-lite", c(30), c(250)),
    ("gemini-3.5-flash", c(150), c(900)),
    ("gemini-3.1-flash-lite", c(25), c(150)),
    ("gemini-3.1-pro", c(200), c(1_200)),
    ("gemini-2.5-pro", c(125), c(1_000)),
    ("gemini-2.5-flash-lite", c(10), c(40)),
    ("gemini-2.5-flash", c(30), c(250)),
    ("gemini-2.0-flash", c(10), c(40)), // retired 2026-06-01
    // ── Through OpenRouter ─────────────────────────────────────────────────
    // The models the dashboard offers, at OpenRouter's rates from its live
    // catalog on 2026-10-02. Matched on the bare id after the vendor slash.
    ("grok-4.7", c(200), c(600)),
    ("deepseek-v4.1-flash", c(30), c(120)),
    ("qwen3.8-max-0902", c(200), c(600)),
    ("kimi-k3", c(270), c(1_350)),
    ("mistral-medium-3-5", c(150), c(750)),
    ("llama-4-maverick", c(19), c(65)),
];

/// Whether `model` is `name` or a dated/suffixed variant of it.
///
/// The boundary must be a `-`: `gpt-4o-mini-2024-07-18` belongs to
/// `gpt-4o-mini`, but `gpt-5.6-sol` must not fall back to `gpt-5`, and
/// `gpt-4.1` must not fall back to `gpt-4`.
fn is_variant_of(model: &str, name: &str) -> bool {
    model == name
        || (model.len() > name.len()
            && model.starts_with(name)
            && model.as_bytes()[name.len()] == b'-')
}

/// Estimated cost in micro-dollars, or `None` when the model is unpriced.
///
/// Returning `None` rather than 0 matters: zero reads as "this was free",
/// which is a different and wrong claim.
pub fn estimate_micro_usd(
    model: &str,
    input_tokens: Option<u32>,
    output_tokens: Option<u32>,
) -> Option<i64> {
    // Without token counts there is nothing to price. Some providers omit
    // usage on streamed responses.
    let (input, output) = (input_tokens?, output_tokens?);

    // An OpenRouter model id is namespaced, e.g. "anthropic/claude-3-5-sonnet".
    // Price on the part after the slash so those resolve too.
    let bare = model.rsplit('/').next().unwrap_or(model);
    let needle = bare.to_ascii_lowercase();

    // Longest match wins, so "gpt-4o-mini" is not priced as "gpt-4o".
    let (_, in_rate, out_rate) = PRICES
        .iter()
        .filter(|(name, _, _)| is_variant_of(&needle, name))
        .max_by_key(|(name, _, _)| name.len())?;

    // Rates are micro-dollars per million tokens. u128 so a very large token
    // count times a flagship rate cannot overflow.
    let cost = (input as u128 * *in_rate as u128 + output as u128 * *out_rate as u128) / 1_000_000;
    i64::try_from(cost).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Dollars to micro-dollars, for writing expectations the way pricing
    /// pages state them.
    fn usd(d: f64) -> i64 {
        (d * 1_000_000.0).round() as i64
    }

    #[test]
    fn prices_a_known_model_in_real_dollars() {
        // gpt-4o-mini: $0.15 in + $0.60 out per 1M. The old table returned
        // 750 micro-dollars here — $0.00075 — for what costs $0.75.
        assert_eq!(
            estimate_micro_usd("gpt-4o-mini", Some(1_000_000), Some(1_000_000)),
            Some(usd(0.75))
        );
    }

    #[test]
    fn a_typical_request_costs_a_plausible_amount() {
        // 1,200 in + 300 out on claude-sonnet-5-5 ($2 / $10 per 1M)
        // = 0.0024 + 0.003 = $0.0054.
        assert_eq!(
            estimate_micro_usd("claude-sonnet-5-5", Some(1_200), Some(300)),
            Some(usd(0.0054))
        );
    }

    #[test]
    fn longest_prefix_wins() {
        // "gpt-4o-mini" is also a variant of "gpt-4o". Picking the shorter
        // match would price the cheapest model at nearly 17x its real cost.
        let mini = estimate_micro_usd("gpt-4o-mini", Some(1_000_000), Some(0)).unwrap();
        let full = estimate_micro_usd("gpt-4o", Some(1_000_000), Some(0)).unwrap();
        assert_eq!(mini, usd(0.15));
        assert_eq!(full, usd(2.50));
    }

    #[test]
    fn resolves_dated_snapshots() {
        assert_eq!(
            estimate_micro_usd("gpt-4o-mini-2024-07-18", Some(1_000_000), Some(0)),
            Some(usd(0.15))
        );
        assert_eq!(
            estimate_micro_usd("claude-haiku-4-5-20251001", Some(1_000_000), Some(0)),
            Some(usd(1.00))
        );
    }

    #[test]
    fn a_new_version_is_unknown_not_its_ancestor() {
        // Raw prefix matching would bill an unreleased gpt-5.7 at gpt-5's
        // rate and gpt-4.1 at gpt-4's (15x too much). Neither is that model.
        assert_eq!(
            estimate_micro_usd("gpt-5.7-nova", Some(1000), Some(1000)),
            None
        );
        assert_eq!(
            estimate_micro_usd("gpt-4.1", Some(1_000_000), Some(0)),
            Some(usd(2.00)),
            "gpt-4.1 must price as itself, not as gpt-4"
        );
    }

    #[test]
    fn resolves_openrouter_namespaced_ids() {
        assert_eq!(
            estimate_micro_usd("anthropic/claude-sonnet-5-5", Some(1_000_000), Some(0)),
            Some(usd(2.00))
        );
        assert_eq!(
            estimate_micro_usd("google/gemini-2.5-flash", Some(1_000_000), Some(0)),
            Some(usd(0.30))
        );
    }

    #[test]
    fn unknown_model_is_none_not_zero() {
        // Zero would render as "$0.00" and read as "this request was free",
        // which is a different claim from "we do not know".
        assert_eq!(
            estimate_micro_usd("some-new-model", Some(1000), Some(1000)),
            None
        );
    }

    #[test]
    fn missing_token_counts_are_none() {
        assert_eq!(estimate_micro_usd("gpt-4o", None, Some(100)), None);
        assert_eq!(estimate_micro_usd("gpt-4o", Some(100), None), None);
    }

    #[test]
    fn huge_token_counts_do_not_overflow() {
        assert!(estimate_micro_usd("o1-pro", Some(u32::MAX), Some(u32::MAX)).is_some());
    }

    #[test]
    fn no_entry_is_shadowed_or_duplicated() {
        // A duplicate name would make one row dead code silently.
        let mut names: Vec<&str> = PRICES.iter().map(|(n, _, _)| *n).collect();
        names.sort_unstable();
        let before = names.len();
        names.dedup();
        assert_eq!(before, names.len(), "duplicate model in PRICES");
    }

    #[test]
    fn every_model_the_dashboard_offers_is_priced() {
        // Mirrors dashboard/lib/models.ts. A model offered in a picker but
        // missing here shows "—" in every cost column for every customer who
        // chooses it; add the price when adding the model.
        for m in [
            "gpt-6-astra",
            "gpt-6.1-sol",
            "gpt-6-luna",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.5",
            "gpt-5.4",
            "gpt-5.4-mini",
            "gpt-5-mini",
            "gpt-4.1",
            "gpt-4.1-mini",
            "gpt-4o",
            "gpt-4o-mini",
            "o3",
            "o4-mini",
            "claude-opus-5-5",
            "claude-sonnet-5-5",
            "claude-haiku-4-5",
            "claude-fable-5-1",
            "claude-opus-4-8",
            "claude-sonnet-4-6",
            "gemini-3.8-flash",
            "gemini-3.5-flash",
            "gemini-3.5-flash-lite",
            "gemini-3.1-pro-preview",
            "gemini-2.5-pro",
            "gemini-2.5-flash",
            "x-ai/grok-4.7",
            "deepseek/deepseek-v4.1-flash",
            "qwen/qwen3.8-max-0902",
            "moonshotai/kimi-k3",
            "mistralai/mistral-medium-3-5",
            "meta-llama/llama-4-maverick",
        ] {
            assert!(
                estimate_micro_usd(m, Some(1000), Some(1000)).is_some(),
                "{m} is offered in the dashboard but has no price"
            );
        }
    }
}
