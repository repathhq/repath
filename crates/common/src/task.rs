//! Supervision for background tasks that must not die quietly.

use futures::FutureExt;
use std::future::Future;
use std::panic::AssertUnwindSafe;

/// Wrap a long-running background future so that a panic inside it ends the
/// whole process instead of just that task.
///
/// The release profile unwinds on panic, so one request handler that panics
/// costs that request rather than every customer's in-flight traffic. The
/// price of unwinding is that a panic in a *background* task — a cache
/// refresher, the billing reconciler — would now end that task and nothing
/// else: the process stays up, health checks stay green, and routing quietly
/// freezes on stale data. This restores, for exactly those tasks, what
/// `panic = "abort"` used to give them: the process exits non-zero and the
/// container supervisor restarts it.
///
/// Only a panic triggers the exit. A task that returns, or is aborted during
/// graceful shutdown, is behaving as designed.
pub fn exit_on_panic<F>(name: &'static str, fut: F) -> impl Future<Output = F::Output>
where
    F: Future,
{
    AssertUnwindSafe(fut)
        .catch_unwind()
        .map(move |outcome| match outcome {
            Ok(value) => value,
            Err(_) => {
                // The panic message itself was already printed by the default
                // hook; this line names which task it took down.
                tracing::error!(
                    task = name,
                    "background task panicked — exiting so the supervisor restarts the process"
                );
                std::process::exit(1);
            }
        })
}
