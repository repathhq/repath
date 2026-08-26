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
//! repath rollout delete   <id-or-name>       Delete a rollout
//! repath rollout history  <id-or-name>       Decision audit log
//! ```
//!
//! # Connection
//!
//! The CLI talks to the Repath management API over HTTP, the same interface the
//! dashboard uses. It previously connected straight to PostgreSQL, which meant
//! it only worked for someone with database access — in a hosted deployment the
//! database is private, so customers could not use it at all.
//!
//! ```text
//! REPATH_API_URL   Gateway base URL   (default: http://localhost:8080)
//! REPATH_API_KEY   Your API key       (dashboard → Settings → API key)
//! ```

use clap::{Parser, Subcommand};
use colored::Colorize;
use std::time::Duration;

mod api_types;
mod client;
mod commands;
mod display;

use client::Client;

#[derive(Parser)]
#[command(
    name = "repath",
    about = "Repath — Progressive delivery for AI models",
    version = env!("CARGO_PKG_VERSION"),
    propagate_version = true,
)]
struct Cli {
    /// Repath gateway base URL. Defaults to REPATH_API_URL, then localhost.
    #[arg(long, env = "REPATH_API_URL", global = true)]
    api_url: Option<String>,

    /// Repath API key. Defaults to the REPATH_API_KEY environment variable.
    #[arg(
        long,
        env = "REPATH_API_KEY",
        global = true,
        hide_env_values = true, // never echo a credential
    )]
    api_key: Option<String>,

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
    /// Delete a rollout and its recorded requests
    Delete {
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

    let client = match Client::new(cli.api_url, cli.api_key) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("{} {}", "error:".red().bold(), e);
            std::process::exit(1);
        }
    };

    let result = match cli.command {
        Commands::Serve { .. } => unreachable!("handled above"),
        Commands::Rollout { action } => match action {
            RolloutAction::Create { file } => commands::create(&client, file).await,
            RolloutAction::List => commands::list(&client).await,
            RolloutAction::Status { id_or_name, watch } => {
                if watch {
                    run_watch_loop(&client, &id_or_name).await
                } else {
                    commands::status(&client, &id_or_name).await
                }
            }
            RolloutAction::Promote { id_or_name } => commands::promote(&client, &id_or_name).await,
            RolloutAction::Rollback { id_or_name } => {
                commands::rollback(&client, &id_or_name).await
            }
            RolloutAction::Pause { id_or_name } => commands::pause(&client, &id_or_name).await,
            RolloutAction::Resume { id_or_name } => commands::resume(&client, &id_or_name).await,
            RolloutAction::Delete { id_or_name } => commands::delete(&client, &id_or_name).await,
            RolloutAction::History { id_or_name } => commands::history(&client, &id_or_name).await,
        },
    };

    if let Err(e) = result {
        eprintln!("{} {}", "error:".red().bold(), e);
        std::process::exit(1);
    }
}

/// Run status in a loop, clearing the terminal every 5 seconds.
/// Ctrl-C exits cleanly.
async fn run_watch_loop(client: &Client, id_or_name: &str) -> anyhow::Result<()> {
    use colored::Colorize;

    println!(
        "{} Watching '{}' — press Ctrl-C to stop",
        "→".cyan().bold(),
        id_or_name.bold()
    );

    loop {
        // Clear terminal (works on UNIX and Windows terminals)
        print!("\x1B[2J\x1B[1;1H");

        commands::status(client, id_or_name).await?;

        println!("\n  {} Refreshing every 5s — Ctrl-C to stop", "⏱".dimmed());

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
