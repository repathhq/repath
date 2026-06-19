//! # Repath Common
//!
//! Shared domain types, errors, and utilities for the Repath progressive delivery system.
//!
//! This crate contains the core domain model that all other Repath components depend on.
//! It is deliberately kept free of infrastructure concerns (no database, no HTTP, no async runtime).

pub mod config;
pub mod error;
pub mod types;

pub use error::{Error, Result};
pub use types::*;
