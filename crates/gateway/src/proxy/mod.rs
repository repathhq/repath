//! HTTP proxy module for forwarding requests to upstream providers
//!
//! This module handles:
//! - HTTP client creation with connection pooling
//! - Request forwarding to OpenAI/Anthropic APIs
//! - SSE (Server-Sent Events) streaming passthrough
//! - Request/response transformation

pub mod client;
pub mod handler;
pub mod provider;
pub mod streaming;

pub use client::create_http_client;
