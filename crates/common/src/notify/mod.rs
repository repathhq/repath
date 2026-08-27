//! Outbound notifications: webhooks, Slack and email.
//!
//! The dashboard has advertised all three since launch with nothing behind
//! them — the Settings forms accepted input, reported success, and discarded
//! it. This module is the delivery side.
//!
//! # Delivery model
//!
//! Everything here is dispatched on a detached task. A rollback decision must
//! not be delayed, retried or failed because a customer's webhook endpoint is
//! slow or down. Failures are recorded in `webhook_deliveries` so the customer
//! can see them, and retried with backoff a bounded number of times.
//!
//! # Why deliveries are logged
//!
//! A webhook that silently stops arriving is one of the most frustrating
//! integration failures there is, because nothing on either side reports it.
//! Recording every attempt with its status code turns "it stopped working" into
//! something the customer can diagnose themselves.

pub mod webhooks;

pub use webhooks::{dispatch_event, Event, EventPayload};

use serde::{Deserialize, Serialize};

/// Events a customer can subscribe to.
///
/// Deliberately small: these are the moments a human might need to know about,
/// not a general activity firehose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    /// The controller returned traffic to the baseline. Usually needs a human.
    Rollback,
    /// Traffic advanced to the next weight step. Routine.
    Advance,
    /// The candidate reached 100% and was promoted. Routine.
    Promote,
    /// A provider started failing and traffic failed over.
    ProviderOutage,
}

impl EventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EventKind::Rollback => "rollback",
            EventKind::Advance => "advance",
            EventKind::Promote => "promote",
            EventKind::ProviderOutage => "provider_outage",
        }
    }

    /// Parse a wire-format event name.
    ///
    /// Named `parse` rather than `from_str` so it does not shadow the
    /// `FromStr` trait method, which is implemented below.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "rollback" => Some(EventKind::Rollback),
            "advance" => Some(EventKind::Advance),
            "promote" => Some(EventKind::Promote),
            "provider_outage" => Some(EventKind::ProviderOutage),
            _ => None,
        }
    }

    /// Human-readable summary used in Slack and email.
    pub fn headline(self, rollout: &str) -> String {
        match self {
            EventKind::Rollback => format!("Rollout '{rollout}' was rolled back"),
            EventKind::Advance => format!("Rollout '{rollout}' advanced"),
            EventKind::Promote => format!("Rollout '{rollout}' was promoted to 100%"),
            EventKind::ProviderOutage => format!("Provider failover during '{rollout}'"),
        }
    }

    /// Whether this event warrants attention rather than being informational.
    ///
    /// Drives colour in Slack and urgency in email — a rollback means something
    /// went wrong and a promote means something went right.
    pub fn is_alarming(self) -> bool {
        matches!(self, EventKind::Rollback | EventKind::ProviderOutage)
    }
}

impl std::str::FromStr for EventKind {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        EventKind::parse(s).ok_or_else(|| {
            format!("unknown event '{s}' (expected rollback, advance, promote or provider_outage)")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_kinds_round_trip_through_strings() {
        for kind in [
            EventKind::Rollback,
            EventKind::Advance,
            EventKind::Promote,
            EventKind::ProviderOutage,
        ] {
            assert_eq!(EventKind::parse(kind.as_str()), Some(kind));
        }
    }

    #[test]
    fn unknown_event_kind_is_rejected() {
        assert_eq!(EventKind::parse("something_else"), None);
        // The FromStr impl reports the same thing, with a helpful message.
        assert!("something_else".parse::<EventKind>().is_err());
    }

    #[test]
    fn only_bad_news_is_alarming() {
        assert!(EventKind::Rollback.is_alarming());
        assert!(EventKind::ProviderOutage.is_alarming());
        assert!(!EventKind::Advance.is_alarming());
        assert!(!EventKind::Promote.is_alarming());
    }

    #[test]
    fn headlines_name_the_rollout() {
        assert!(EventKind::Rollback
            .headline("checkout-prompt")
            .contains("checkout-prompt"));
    }
}
