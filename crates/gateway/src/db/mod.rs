//! Database operations module
//!
//! This module provides the database layer for the gateway, including:
//! - Connection pool management
//! - CRUD operations for versions and rollouts
//! - Request logging
//! - Metrics queries

pub mod pool;
pub mod rollouts;
pub mod versions;

pub use pool::{create_pool, verify_connection};
