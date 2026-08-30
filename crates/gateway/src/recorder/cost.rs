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

/// Cost per million tokens, in micro-dollars, as (input, output).
///
/// Sourced from public list prices. Matching is longest-prefix, so dated
/// snapshots like `gpt-4o-mini-2024-07-18` resolve to their base model.
const PRICES: &[(&str, u64, u64)] = &[
    // OpenAI
    ("gpt-4o-mini", 150, 600),
    ("gpt-4o", 2_500, 10_000),
    ("gpt-4-turbo", 10_000, 30_000),
    ("gpt-4", 30_000, 60_000),
    ("gpt-3.5-turbo", 500, 1_500),
    ("o1-mini", 1_100, 4_400),
    ("o1", 15_000, 60_000),
    // Anthropic
    ("claude-3-5-haiku", 800, 4_000),
    ("claude-3-5-sonnet", 3_000, 15_000),
    ("claude-3-opus", 15_000, 75_000),
    ("claude-3-haiku", 250, 1_250),
    ("claude-sonnet-4", 3_000, 15_000),
    ("claude-opus-4", 15_000, 75_000),
    // Google
    ("gemini-1.5-flash", 75, 300),
    ("gemini-1.5-pro", 1_250, 5_000),
    ("gemini-2.0-flash", 100, 400),
];

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
        .filter(|(name, _, _)| needle.starts_with(name))
        .max_by_key(|(name, _, _)| name.len())?;

    // Rates are per million tokens, already in micro-dollars.
    let cost = (input as u64 * in_rate + output as u64 * out_rate) / 1_000_000;
    Some(cost as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prices_a_known_model() {
        // 1M input + 1M output of gpt-4o-mini = 150 + 600 micro-dollars.
        assert_eq!(
            estimate_micro_usd("gpt-4o-mini", Some(1_000_000), Some(1_000_000)),
            Some(750)
        );
    }

    #[test]
    fn longest_prefix_wins() {
        // "gpt-4o-mini" also starts with "gpt-4o". Picking the shorter match
        // would price the cheapest model at nearly 17x its real cost.
        let mini = estimate_micro_usd("gpt-4o-mini", Some(1_000_000), Some(0)).unwrap();
        let full = estimate_micro_usd("gpt-4o", Some(1_000_000), Some(0)).unwrap();
        assert_eq!(mini, 150);
        assert_eq!(full, 2_500);
        assert!(mini < full);
    }

    #[test]
    fn resolves_dated_snapshots() {
        assert_eq!(
            estimate_micro_usd("gpt-4o-mini-2024-07-18", Some(1_000_000), Some(0)),
            Some(150)
        );
    }

    #[test]
    fn resolves_openrouter_namespaced_ids() {
        assert_eq!(
            estimate_micro_usd("anthropic/claude-3-5-sonnet", Some(1_000_000), Some(0)),
            Some(3_000)
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
    fn is_case_insensitive() {
        assert_eq!(
            estimate_micro_usd("GPT-4O-MINI", Some(1_000_000), Some(0)),
            Some(150)
        );
    }
}
