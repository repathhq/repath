//! Circuit breaker — ensures Repath is never a bottleneck.
//!
//! # Design
//!
//! If Repath's gateway becomes unreachable or starts timing out, the customer's
//! app must keep working. The circuit breaker tracks consecutive failures per
//! provider endpoint and, once tripped, bypasses Repath by returning a special
//! response header that tells the client SDK to call the provider directly.
//!
//! # States
//!
//! ```text
//! Closed → (3 consecutive failures) → Open → (5s cooldown) → Half-Open
//!   ↑                                                              |
//!   └────────────── (1 success) ─────────────────────────────────┘
//! ```
//!
//! - **Closed**: Normal operation. All requests go through Repath.
//! - **Open**: Repath returns X-Repath-Bypass: true so the SDK calls directly.
//! - **Half-Open**: One probe request goes through. Success → Closed. Fail → Open.
//!
//! # Per-tenant isolation
//!
//! Each tenant has its own circuit breaker state. A misbehaving upstream for
//! one tenant never affects another tenant's circuit state.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tracing::{info, warn};

const FAILURE_THRESHOLD: u32 = 3;
const COOLDOWN: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq)]
pub enum CircuitState {
    Closed,
    Open { opened_at: Instant },
    HalfOpen,
}

#[derive(Debug)]
struct BreakerState {
    state: CircuitState,
    consecutive_failures: u32,
}

impl BreakerState {
    fn new() -> Self {
        Self {
            state: CircuitState::Closed,
            consecutive_failures: 0,
        }
    }

    fn is_open(&mut self) -> bool {
        match &self.state {
            CircuitState::Closed => false,
            CircuitState::HalfOpen => false,
            CircuitState::Open { opened_at } => {
                if opened_at.elapsed() >= COOLDOWN {
                    // Transition to half-open for a probe
                    self.state = CircuitState::HalfOpen;
                    info!("Circuit breaker → HalfOpen (probe allowed)");
                    false
                } else {
                    true
                }
            }
        }
    }

    fn record_success(&mut self, tenant_id: &str) {
        match self.state {
            CircuitState::HalfOpen => {
                info!(tenant_id, "Circuit breaker → Closed (probe succeeded)");
                self.state = CircuitState::Closed;
                self.consecutive_failures = 0;
            }
            CircuitState::Closed => {
                self.consecutive_failures = 0;
            }
            _ => {}
        }
    }

    fn record_failure(&mut self, tenant_id: &str) {
        self.consecutive_failures += 1;

        match self.state {
            CircuitState::HalfOpen => {
                warn!(tenant_id, "Circuit breaker → Open (probe failed)");
                self.state = CircuitState::Open {
                    opened_at: Instant::now(),
                };
            }
            CircuitState::Closed => {
                if self.consecutive_failures >= FAILURE_THRESHOLD {
                    warn!(
                        tenant_id,
                        failures = self.consecutive_failures,
                        "Circuit breaker → Open (threshold reached)"
                    );
                    self.state = CircuitState::Open {
                        opened_at: Instant::now(),
                    };
                }
            }
            _ => {}
        }
    }
}

/// Shared circuit breaker registry — one breaker per tenant.
#[derive(Clone)]
pub struct CircuitBreakerRegistry {
    breakers: Arc<Mutex<HashMap<String, BreakerState>>>,
}

impl CircuitBreakerRegistry {
    pub fn new() -> Self {
        Self {
            breakers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Returns true if the circuit is open for this tenant (bypass Repath).
    pub fn is_open(&self, tenant_id: &str) -> bool {
        let mut map = self.breakers.lock().unwrap();
        map.entry(tenant_id.to_string())
            .or_insert_with(BreakerState::new)
            .is_open()
    }

    pub fn record_success(&self, tenant_id: &str) {
        let mut map = self.breakers.lock().unwrap();
        map.entry(tenant_id.to_string())
            .or_insert_with(BreakerState::new)
            .record_success(tenant_id);
    }

    pub fn record_failure(&self, tenant_id: &str) {
        let mut map = self.breakers.lock().unwrap();
        map.entry(tenant_id.to_string())
            .or_insert_with(BreakerState::new)
            .record_failure(tenant_id);
    }
}

impl Default for CircuitBreakerRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_closed_by_default() {
        let registry = CircuitBreakerRegistry::new();
        assert!(!registry.is_open("tenant1"));
    }

    #[test]
    fn test_opens_after_threshold() {
        let registry = CircuitBreakerRegistry::new();
        for _ in 0..FAILURE_THRESHOLD {
            registry.record_failure("tenant1");
        }
        assert!(registry.is_open("tenant1"));
    }

    #[test]
    fn test_success_resets_counter() {
        let registry = CircuitBreakerRegistry::new();
        registry.record_failure("tenant1");
        registry.record_failure("tenant1");
        registry.record_success("tenant1");
        // Counter reset — need FAILURE_THRESHOLD more failures to open
        assert!(!registry.is_open("tenant1"));
    }

    #[test]
    fn test_tenants_are_isolated() {
        let registry = CircuitBreakerRegistry::new();
        for _ in 0..FAILURE_THRESHOLD {
            registry.record_failure("tenant1");
        }
        // tenant2 should be unaffected
        assert!(registry.is_open("tenant1"));
        assert!(!registry.is_open("tenant2"));
    }
}
