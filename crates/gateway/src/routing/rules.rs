//! Conditional model routing.
//!
//! A rule says: *when a request looks like this, send it to that model*. Rules
//! are evaluated in priority order and the first match wins — the same model as
//! a firewall or load-balancer rule set, which is what people already expect
//! and can reason about without reading documentation.
//!
//! # How this relates to rollouts
//!
//! Rollouts and routing rules answer different questions:
//!
//! - A **rollout** asks "is my new prompt better than my current one?" and
//!   splits traffic between two versions to find out.
//! - A **routing rule** asks "which model should serve this particular
//!   request?" — cheap model for short prompts, strong model for long ones.
//!
//! A request matched by a rule is served by that rule and takes no part in a
//! canary. Letting both act on one request would mean a rollout's quality
//! numbers silently mixed in traffic the rollout never chose, making its
//! advance and rollback decisions meaningless.
//!
//! # Evaluation cost
//!
//! This runs on every proxied request, so it must stay cheap: rules are held
//! in an `ArcSwap` cache refreshed every 5 seconds, matching is a handful of
//! comparisons over already-parsed values, and nothing here touches the
//! database or allocates in the common path.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

/// What a rule looks at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Field {
    /// Approximate size of the prompt, in tokens.
    InputTokens,
    /// The model the client asked for, e.g. "gpt-4o".
    Model,
    /// Request path, e.g. "/v1/chat/completions".
    Path,
    /// Combined text of the messages — for content-based routing.
    Content,
    /// A request header, named by `Condition::header`.
    Header,
}

/// How the field is compared.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Operator {
    Eq,
    Neq,
    Lt,
    Lte,
    Gt,
    Gte,
    Contains,
    NotContains,
    StartsWith,
    Exists,
}

impl Operator {
    /// Whether this operator compares numbers rather than text.
    fn is_numeric(self) -> bool {
        matches!(
            self,
            Operator::Lt | Operator::Lte | Operator::Gt | Operator::Gte
        )
    }
}

/// One condition. Kept deliberately flat — a single comparison rather than a
/// nestable boolean expression. Arbitrary nesting is far harder to display,
/// validate and debug, and ordered single-condition rules cover the cases
/// people actually ask for.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Condition {
    pub field: Field,
    pub op: Operator,
    #[serde(default)]
    pub value: String,
    /// Header name, required when `field` is `Header`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
}

/// Where a matching request is sent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub provider: String,
    pub model: String,
}

/// A rule as held in memory.
#[derive(Debug, Clone)]
pub struct RoutingRule {
    pub id: Uuid,
    pub name: String,
    pub priority: i32,
    pub condition: Condition,
    pub action: Action,
}

/// The facts about a request that rules can match on.
///
/// Built once per request and borrowed by every rule, so evaluating twenty
/// rules costs twenty comparisons rather than twenty re-parses.
///
/// Owned rather than borrowed: `model` and `content` are *derived* from the
/// body (joined message text, extracted field) rather than being slices of it,
/// so borrowing would force the caller into lifetime gymnastics or, worse,
/// leaking them to get a `'static`. Two small allocations per request are
/// nothing next to the upstream LLM call this precedes.
#[derive(Debug, Default)]
pub struct RequestFacts {
    pub input_tokens: u32,
    pub model: String,
    pub path: String,
    pub content: String,
    pub headers: HashMap<String, String>,
}

impl Condition {
    /// Whether this condition holds for the request.
    pub fn matches(&self, facts: &RequestFacts) -> bool {
        // `Exists` is only meaningful for headers; for any other field the
        // value is always present, so the condition is trivially true.
        if self.op == Operator::Exists {
            return match self.field {
                Field::Header => self
                    .header
                    .as_ref()
                    .is_some_and(|h| facts.headers.contains_key(&h.to_ascii_lowercase())),
                _ => true,
            };
        }

        if self.op.is_numeric() {
            return self.matches_numeric(facts);
        }

        let actual = match self.field {
            Field::Model => facts.model.clone(),
            Field::Path => facts.path.clone(),
            Field::Content => facts.content.clone(),
            Field::InputTokens => facts.input_tokens.to_string(),
            Field::Header => match self.header.as_ref() {
                Some(h) => match facts.headers.get(&h.to_ascii_lowercase()) {
                    Some(v) => v.clone(),
                    // A missing header matches only "not contains" / "neq",
                    // which is what a reader intuitively expects.
                    None => {
                        return matches!(self.op, Operator::Neq | Operator::NotContains);
                    }
                },
                None => return false,
            },
        };

        // Text comparison is case-insensitive: model names and header values
        // vary in case across providers, and a rule that silently fails on
        // "GPT-4o" vs "gpt-4o" is a support ticket waiting to happen.
        let actual = actual.to_ascii_lowercase();
        let expected = self.value.to_ascii_lowercase();

        match self.op {
            Operator::Eq => actual == expected,
            Operator::Neq => actual != expected,
            Operator::Contains => actual.contains(&expected),
            Operator::NotContains => !actual.contains(&expected),
            Operator::StartsWith => actual.starts_with(&expected),
            _ => false, // numeric and Exists handled above
        }
    }

    fn matches_numeric(&self, facts: &RequestFacts) -> bool {
        let actual: f64 = match self.field {
            Field::InputTokens => facts.input_tokens as f64,
            // Comparing a non-numeric field numerically is a malformed rule.
            // Validation rejects it on save; refuse to match rather than
            // coercing it into something surprising.
            _ => return false,
        };

        let Ok(expected) = self.value.trim().parse::<f64>() else {
            return false;
        };

        match self.op {
            Operator::Lt => actual < expected,
            Operator::Lte => actual <= expected,
            Operator::Gt => actual > expected,
            Operator::Gte => actual >= expected,
            _ => false,
        }
    }
}

/// Immutable snapshot of every tenant's enabled rules, in priority order.
#[derive(Debug, Default)]
pub struct RulesCache {
    by_tenant: HashMap<String, Vec<Arc<RoutingRule>>>,
}

impl RulesCache {
    pub fn empty() -> Self {
        Self::default()
    }

    pub fn from_rules(mut by_tenant: HashMap<String, Vec<Arc<RoutingRule>>>) -> Self {
        // Sort once here rather than on every request. Ties break on name so
        // the order is deterministic and a rule cannot silently change
        // precedence between refreshes.
        for rules in by_tenant.values_mut() {
            rules.sort_by(|a, b| {
                a.priority
                    .cmp(&b.priority)
                    .then_with(|| a.name.cmp(&b.name))
            });
        }
        Self { by_tenant }
    }

    /// The first rule matching this request, or `None` to fall through to
    /// normal rollout routing.
    pub fn first_match(&self, tenant_id: &str, facts: &RequestFacts) -> Option<Arc<RoutingRule>> {
        self.by_tenant
            .get(tenant_id)?
            .iter()
            .find(|r| r.condition.matches(facts))
            .cloned()
    }

    pub fn rules_for(&self, tenant_id: &str) -> &[Arc<RoutingRule>] {
        self.by_tenant.get(tenant_id).map_or(&[], Vec::as_slice)
    }

    pub fn total(&self) -> usize {
        self.by_tenant.values().map(Vec::len).sum()
    }
}

/// Rough token count for a prompt.
///
/// Deliberately an estimate: a real tokenizer would mean shipping per-model
/// vocabularies and spending real CPU on the hot path, to decide something as
/// coarse as "is this prompt big or small". Roughly four characters per token
/// holds well enough for English prose to route on.
///
/// Rules that need exactness should match on content or headers instead.
pub fn estimate_tokens(text: &str) -> u32 {
    (text.chars().count() as f64 / 4.0).ceil() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(tokens: u32, model: &str, content: &str) -> RequestFacts {
        RequestFacts {
            input_tokens: tokens,
            model: model.into(),
            path: "/v1/chat/completions".into(),
            content: content.into(),
            headers: HashMap::new(),
        }
    }

    fn cond(field: Field, op: Operator, value: &str) -> Condition {
        Condition {
            field,
            op,
            value: value.into(),
            header: None,
        }
    }

    // ── numeric ─────────────────────────────────────────────────────────────

    #[test]
    fn routes_short_prompts_to_the_cheap_model() {
        let c = cond(Field::InputTokens, Operator::Lt, "500");
        assert!(c.matches(&facts(100, "gpt-4o", "")));
        assert!(!c.matches(&facts(900, "gpt-4o", "")));
    }

    #[test]
    fn numeric_boundaries_are_exact() {
        let lt = cond(Field::InputTokens, Operator::Lt, "500");
        let lte = cond(Field::InputTokens, Operator::Lte, "500");
        assert!(!lt.matches(&facts(500, "m", "")), "lt is exclusive");
        assert!(lte.matches(&facts(500, "m", "")), "lte is inclusive");
    }

    #[test]
    fn gt_and_gte_behave_symmetrically() {
        assert!(!cond(Field::InputTokens, Operator::Gt, "500").matches(&facts(500, "m", "")));
        assert!(cond(Field::InputTokens, Operator::Gte, "500").matches(&facts(500, "m", "")));
    }

    #[test]
    fn unparseable_numeric_value_never_matches() {
        // A malformed rule must not capture traffic it was never meant to.
        let c = cond(Field::InputTokens, Operator::Lt, "not-a-number");
        assert!(!c.matches(&facts(1, "m", "")));
    }

    #[test]
    fn numeric_operator_on_a_text_field_never_matches() {
        let c = cond(Field::Model, Operator::Lt, "500");
        assert!(!c.matches(&facts(1, "gpt-4o", "")));
    }

    // ── text ────────────────────────────────────────────────────────────────

    #[test]
    fn model_equality_ignores_case() {
        let c = cond(Field::Model, Operator::Eq, "gpt-4o");
        assert!(c.matches(&facts(1, "GPT-4o", "")));
        assert!(c.matches(&facts(1, "gpt-4o", "")));
    }

    #[test]
    fn model_equality_is_exact_not_prefix() {
        let c = cond(Field::Model, Operator::Eq, "gpt-4o");
        assert!(
            !c.matches(&facts(1, "gpt-4o-mini", "")),
            "eq must not match a longer model name"
        );
    }

    #[test]
    fn starts_with_matches_a_model_family() {
        let c = cond(Field::Model, Operator::StartsWith, "claude-3-5");
        assert!(c.matches(&facts(1, "claude-3-5-sonnet-20241022", "")));
        assert!(!c.matches(&facts(1, "claude-3-opus", "")));
    }

    #[test]
    fn content_contains_enables_topic_routing() {
        let c = cond(Field::Content, Operator::Contains, "refund");
        assert!(c.matches(&facts(1, "m", "I need a REFUND please")));
        assert!(!c.matches(&facts(1, "m", "where is my order")));
    }

    #[test]
    fn not_contains_is_the_inverse() {
        let c = cond(Field::Content, Operator::NotContains, "refund");
        assert!(!c.matches(&facts(1, "m", "refund me")));
        assert!(c.matches(&facts(1, "m", "hello")));
    }

    // ── headers ─────────────────────────────────────────────────────────────

    fn with_header(name: &str, value: &str) -> RequestFacts {
        let mut f = RequestFacts {
            input_tokens: 0,
            model: "gpt-4o".into(),
            path: "/v1/chat/completions".into(),
            content: String::new(),
            headers: HashMap::new(),
        };
        f.headers.insert(name.into(), value.into());
        f
    }

    #[test]
    fn header_equality_matches_case_insensitively_on_the_name() {
        let c = Condition {
            field: Field::Header,
            op: Operator::Eq,
            value: "premium".into(),
            header: Some("X-Customer-Tier".into()),
        };
        assert!(c.matches(&with_header("x-customer-tier", "premium")));
    }

    #[test]
    fn header_exists_checks_presence_only() {
        let c = Condition {
            field: Field::Header,
            op: Operator::Exists,
            value: String::new(),
            header: Some("X-Beta".into()),
        };
        assert!(c.matches(&with_header("x-beta", "anything")));
        assert!(!c.matches(&facts(1, "m", "")));
    }

    #[test]
    fn missing_header_matches_only_negative_operators() {
        let base = |op| Condition {
            field: Field::Header,
            op,
            value: "premium".into(),
            header: Some("X-Tier".into()),
        };
        let no_header = facts(1, "m", "");
        assert!(!base(Operator::Eq).matches(&no_header));
        assert!(base(Operator::Neq).matches(&no_header));
        assert!(base(Operator::NotContains).matches(&no_header));
        assert!(!base(Operator::Contains).matches(&no_header));
    }

    #[test]
    fn header_condition_without_a_header_name_never_matches() {
        let c = cond(Field::Header, Operator::Eq, "x");
        assert!(!c.matches(&with_header("anything", "x")));
    }

    // ── ordering ────────────────────────────────────────────────────────────

    fn rule(name: &str, priority: i32, c: Condition, model: &str) -> Arc<RoutingRule> {
        Arc::new(RoutingRule {
            id: Uuid::new_v4(),
            name: name.into(),
            priority,
            condition: c,
            action: Action {
                provider: "anthropic".into(),
                model: model.into(),
            },
        })
    }

    fn cache(rules: Vec<Arc<RoutingRule>>) -> RulesCache {
        let mut m = HashMap::new();
        m.insert("ten_a".to_string(), rules);
        RulesCache::from_rules(m)
    }

    #[test]
    fn lowest_priority_number_wins() {
        let c = cache(vec![
            rule(
                "second",
                200,
                cond(Field::InputTokens, Operator::Lt, "1000"),
                "sonnet",
            ),
            rule(
                "first",
                10,
                cond(Field::InputTokens, Operator::Lt, "1000"),
                "haiku",
            ),
        ]);
        let hit = c.first_match("ten_a", &facts(100, "m", "")).unwrap();
        assert_eq!(hit.name, "first");
        assert_eq!(hit.action.model, "haiku");
    }

    #[test]
    fn falls_through_when_nothing_matches() {
        let c = cache(vec![rule(
            "big-only",
            10,
            cond(Field::InputTokens, Operator::Gt, "10000"),
            "opus",
        )]);
        assert!(c.first_match("ten_a", &facts(5, "m", "")).is_none());
    }

    #[test]
    fn rules_are_scoped_to_their_tenant() {
        let c = cache(vec![rule(
            "any",
            1,
            cond(Field::InputTokens, Operator::Gte, "0"),
            "haiku",
        )]);
        assert!(c.first_match("ten_a", &facts(1, "m", "")).is_some());
        assert!(
            c.first_match("ten_other", &facts(1, "m", "")).is_none(),
            "one tenant's rules must never route another tenant's traffic"
        );
    }

    #[test]
    fn equal_priorities_break_deterministically_on_name() {
        let c = cache(vec![
            rule(
                "bravo",
                50,
                cond(Field::InputTokens, Operator::Gte, "0"),
                "b",
            ),
            rule(
                "alpha",
                50,
                cond(Field::InputTokens, Operator::Gte, "0"),
                "a",
            ),
        ]);
        assert_eq!(
            c.first_match("ten_a", &facts(1, "m", "")).unwrap().name,
            "alpha"
        );
    }

    #[test]
    fn empty_cache_matches_nothing() {
        let c = RulesCache::empty();
        assert!(c.first_match("ten_a", &facts(1, "m", "")).is_none());
        assert_eq!(c.total(), 0);
    }

    // ── token estimation ────────────────────────────────────────────────────

    #[test]
    fn token_estimate_is_roughly_four_chars_each() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2); // rounds up
        assert_eq!(estimate_tokens(&"a".repeat(400)), 100);
    }

    #[test]
    fn token_estimate_counts_characters_not_bytes() {
        // Four multi-byte characters are four characters, not twelve bytes.
        assert_eq!(estimate_tokens("→→→→"), 1);
    }

    // ── serde round-trip (rules are stored as JSONB) ────────────────────────

    #[test]
    fn condition_round_trips_through_json() {
        let c = Condition {
            field: Field::InputTokens,
            op: Operator::Lt,
            value: "500".into(),
            header: None,
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains("input_tokens"), "got {json}");
        assert!(json.contains("\"lt\""), "got {json}");
        let back: Condition = serde_json::from_str(&json).unwrap();
        assert_eq!(back.field, Field::InputTokens);
        assert_eq!(back.op, Operator::Lt);
    }

    #[test]
    fn action_round_trips_through_json() {
        let a = Action {
            provider: "anthropic".into(),
            model: "claude-3-5-haiku-20241022".into(),
        };
        let back: Action = serde_json::from_str(&serde_json::to_string(&a).unwrap()).unwrap();
        assert_eq!(back.provider, "anthropic");
        assert_eq!(back.model, "claude-3-5-haiku-20241022");
    }
}
