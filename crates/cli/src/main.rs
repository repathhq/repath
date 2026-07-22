//! Repath CLI — manage progressive AI rollouts from the terminal.
//!
//! ```text
//! repath rollout create   -f rollout.yaml   Create and start a new rollout
//! repath rollout list                        List all rollouts
//! repath rollout status   <id-or-name>       Detailed rollout status
//! repath rollout status   <id-or-name> --watch  Live-updating status
//! repath rollout promote  <id-or-name>       Force-promote candidate to 100%
//! repath rollout rollback <id-or-name>       Force-rollback to baseline
//! repath rollout pause    <id-or-name>       Pause controller decisions
//! repath rollout resume   <id-or-name>       Resume a paused rollout
//! repath rollout history  <id-or-name>       Decision audit log
//! ```
//!
//! # Connection
//!
//! The CLI connects directly to PostgreSQL — no running gateway needed.
//! This is the same pattern as `kubectl` (connects to API server directly)
//! and `flyctl` (connects to Fly's API directly).
//!
//! Database URL is read from: REPATH_DATABASE_URL env var, or --database-url flag.

use clap::{Parser, Subcommand};
use colored::Colorize;
use sqlx::postgres::PgPoolOptions;
use std::time::Duration;

mod commands;
mod display;

#[derive(Parser)]
#[command(
    name = "repath",
    about = "Repath — Progressive delivery for AI models",
    version = env!("CARGO_PKG_VERSION"),
    propagate_version = true,
)]
struct Cli {
    /// PostgreSQL connection string.
    /// Defaults to REPATH_DATABASE_URL environment variable.
    #[arg(
        long,
        env = "REPATH_DATABASE_URL",
        global = true,
        hide_env_values = true, // Don't print the URL (contains password)
    )]
    database_url: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the Repath gateway and controller (single-command startup)
    Serve {
        /// Config file path (defaults to repath.toml in current directory)
        #[arg(long, default_value = "repath.toml")]
        config: String,
    },
    /// Manage rollouts
    Rollout {
        #[command(subcommand)]
        action: RolloutAction,
    },
}

#[derive(Subcommand)]
enum RolloutAction {
    /// Create a new rollout from a YAML configuration file
    Create {
        /// Path to the rollout YAML file
        #[arg(short, long, value_name = "FILE")]
        file: std::path::PathBuf,
    },
    /// List all rollouts (active and recent)
    List,
    /// Show detailed status for a rollout
    Status {
        /// Rollout ID or name
        #[arg(value_name = "ID_OR_NAME")]
        id_or_name: String,
        /// Refresh every 5 seconds (live view)
        #[arg(long)]
        watch: bool,
    },
    /// Force-promote the candidate to 100% traffic
    Promote {
        /// Rollout ID or name
        #[arg(value_name = "ID_OR_NAME")]
        id_or_name: String,
    },
    /// Force-rollback to 100% baseline immediately
    Rollback {
        /// Rollout ID or name
        #[arg(value_name = "ID_OR_NAME")]
        id_or_name: String,
    },
    /// Pause controller decisions for a rollout
    Pause {
        /// Rollout ID or name
        #[arg(value_name = "ID_OR_NAME")]
        id_or_name: String,
    },
    /// Resume a paused rollout
    Resume {
        /// Rollout ID or name
        #[arg(value_name = "ID_OR_NAME")]
        id_or_name: String,
    },
    /// Show the decision audit history for a rollout
    History {
        /// Rollout ID or name
        #[arg(value_name = "ID_OR_NAME")]
        id_or_name: String,
    },
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    // `repath serve` doesn't need a DB connection — handle it before pool setup
    if let Commands::Serve { .. } = &cli.command {
        println!(
            "{}",
            "Use docker compose up to start all services.".dimmed()
        );
        println!("{}", "Standalone 'repath serve' coming in v0.2.".dimmed());
        return;
    }

    let db_url = match cli.database_url {
        Some(url) => url,
        None => {
            eprintln!("{} No database URL provided.", "error:".red().bold());
            eprintln!(
                "{}",
                "Set REPATH_DATABASE_URL or pass --database-url <URL>".dimmed()
            );
            std::process::exit(1);
        }
    };

    let pool = match PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&db_url)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{} {}", "error:".red().bold(), e);
            eprintln!(
                "{}",
                "Check that REPATH_DATABASE_URL is set and the database is reachable.".dimmed()
            );
            std::process::exit(1);
        }
    };

    let result = match cli.command {
        Commands::Serve { .. } => unreachable!("handled above"),
        Commands::Rollout { action } => match action {
            RolloutAction::Create { file } => commands::create(&pool, file).await,
            RolloutAction::List => commands::list(&pool).await,
            RolloutAction::Status { id_or_name, watch } => {
                if watch {
                    run_watch_loop(&pool, &id_or_name).await
                } else {
                    commands::status(&pool, &id_or_name).await
                }
            }
            RolloutAction::Promote { id_or_name } => commands::promote(&pool, &id_or_name).await,
            RolloutAction::Rollback { id_or_name } => commands::rollback(&pool, &id_or_name).await,
            RolloutAction::Pause { id_or_name } => commands::pause(&pool, &id_or_name).await,
            RolloutAction::Resume { id_or_name } => commands::resume(&pool, &id_or_name).await,
            RolloutAction::History { id_or_name } => commands::history(&pool, &id_or_name).await,
        },
    };

    pool.close().await;

    if let Err(e) = result {
        eprintln!("{} {}", "error:".red().bold(), e);
        std::process::exit(1);
    }
}

/// Run status in a loop, clearing the terminal every 5 seconds.
/// Ctrl-C exits cleanly.
async fn run_watch_loop(pool: &sqlx::PgPool, id_or_name: &str) -> anyhow::Result<()> {
    use colored::Colorize;

    println!(
        "{} Watching '{}' — press Ctrl-C to stop",
        "→".cyan().bold(),
        id_or_name.bold()
    );

    loop {
        // Clear terminal (works on UNIX and Windows terminals)
        print!("\x1B[2J\x1B[1;1H");

        commands::status(pool, id_or_name).await?;

        println!(
            "\n  {} Refreshing every 5s — Ctrl-C to stop",
            "⏱".dimmed()
        );

        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(5)) => {}
            _ = tokio::signal::ctrl_c() => {
                println!("\n{}", "Stopped.".dimmed());
                break;
            }
        }
    }

    Ok(())
}
