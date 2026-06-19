//! Observability module (tracing + metrics)

pub mod metrics;
pub mod tracing_setup;

pub use metrics::{Metrics, serve_metrics};
pub use tracing_setup::init_tracing;
