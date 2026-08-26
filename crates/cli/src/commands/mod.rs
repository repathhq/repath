//! CLI commands, all implemented against the management HTTP API.
//!
//! Each command is a thin translation: call the API, render the result with
//! the shared helpers in [`crate::display`]. No SQL lives here any more — see
//! [`crate::client`] for why.

use anyhow::{Context, Result};
use colored::Colorize;
use comfy_table::Cell;
use std::path::PathBuf;

use crate::api_types::*;
use crate::client::Client;
use crate::display::{
    decision_action, kv, make_table, quality_score, relative_time, section, state_badge,
    traffic_bar, weight_pct,
};

// ── create ──────────────────────────────────────────────────────────────────

/// `repath rollout create -f rollout.yaml`
///
/// The YAML is parsed locally so mistakes are caught before a network call,
/// then posted as JSON. The gateway re-validates — never trust a client — but
/// parsing here gives a much better error message with the file in hand.
pub async fn create(client: &Client, file: PathBuf) -> Result<()> {
    let yaml = std::fs::read_to_string(&file)
        .with_context(|| format!("Could not read {}", file.display()))?;

    let config: serde_yaml::Value = serde_yaml::from_str(&yaml)
        .with_context(|| format!("{} is not valid YAML", file.display()))?;

    let json =
        serde_json::to_value(&config).context("Could not convert the rollout config to JSON")?;

    println!("{} Creating rollout...", "→".cyan().bold());

    let created: CreatedRollout = client.post("rollouts", Some(&json)).await?;

    println!(
        "{} Rollout {} created",
        "✓".green().bold(),
        created.name.bold()
    );
    println!();
    kv("ID", &created.id.to_string());
    kv("Steps", &created.steps.to_string());
    println!();
    println!(
        "{}",
        "The controller will start routing traffic automatically.".dimmed()
    );
    println!(
        "{}",
        format!(
            "Run `repath rollout status {}` to monitor progress.",
            created.name
        )
        .dimmed()
    );

    Ok(())
}

// ── list ────────────────────────────────────────────────────────────────────

pub async fn list(client: &Client) -> Result<()> {
    let list: RolloutList = client.get("rollouts").await?;

    if list.rollouts.is_empty() {
        println!("{}", "No rollouts found.".dimmed());
        println!(
            "{}",
            "Create one with: repath rollout create -f rollout.yaml".dimmed()
        );
        return Ok(());
    }

    let mut table = make_table(vec![
        "NAME",
        "STATE",
        "TRAFFIC",
        "QUALITY",
        "BASELINE",
        "CANDIDATE",
        "CREATED",
    ]);

    for r in &list.rollouts {
        // Prefer the candidate's score — that is the number a rollout is
        // being judged on. Fall back to the baseline before giving up.
        let quality = r
            .avg_quality_candidate
            .or(r.avg_quality_baseline)
            .map(quality_score)
            .unwrap_or_else(|| "—".dimmed().to_string());

        table.add_row(vec![
            Cell::new(&r.name),
            Cell::new(state_badge(&r.state)),
            Cell::new(weight_pct(r.current_weight)),
            Cell::new(quality),
            Cell::new(&r.baseline_model),
            Cell::new(&r.candidate_model),
            Cell::new(relative_time(&r.created_at)),
        ]);
    }

    println!("{table}");
    println!(
        "  {} rollout(s). Use `repath rollout status <name>` for details.",
        list.rollouts.len()
    );

    Ok(())
}

// ── status ──────────────────────────────────────────────────────────────────

pub async fn status(client: &Client, id_or_name: &str) -> Result<()> {
    let d: RolloutDetail = client.get(&format!("rollouts/{id_or_name}")).await?;
    let steps: StepList = client
        .get(&format!("rollouts/{id_or_name}/steps"))
        .await
        .unwrap_or(StepList { steps: vec![] });

    section(&format!("Rollout: {}", d.name));
    kv("ID", &d.id.to_string());
    kv("State", &state_badge(&d.state));
    kv("Created", &relative_time(&d.created_at));
    println!();

    section("Traffic split");
    traffic_bar("baseline ", 1.0 - d.current_weight, 30);
    traffic_bar("candidate", d.current_weight, 30);
    println!();

    section("Comparison");
    let mut table = make_table(vec!["METRIC", "BASELINE", "CANDIDATE"]);
    table.add_row(vec![
        Cell::new("model"),
        Cell::new(&d.baseline_model),
        Cell::new(&d.candidate_model),
    ]);
    table.add_row(vec![
        Cell::new("quality"),
        Cell::new(opt_quality(d.avg_quality_baseline)),
        Cell::new(opt_quality(d.avg_quality_candidate)),
    ]);
    table.add_row(vec![
        Cell::new("p95 latency"),
        Cell::new(opt_ms(d.p95_latency_baseline)),
        Cell::new(opt_ms(d.p95_latency_candidate)),
    ]);
    table.add_row(vec![
        Cell::new("error rate"),
        Cell::new(opt_pct(d.error_rate_baseline)),
        Cell::new(opt_pct(d.error_rate_candidate)),
    ]);
    table.add_row(vec![
        Cell::new("samples"),
        Cell::new(opt_count(d.sample_count_baseline)),
        Cell::new(opt_count(d.sample_count_candidate)),
    ]);
    println!("{table}");

    if !steps.steps.is_empty() {
        println!();
        section("Steps");
        let mut st = make_table(vec!["#", "TARGET", "STATUS", "GATE"]);
        for s in &steps.steps {
            st.add_row(vec![
                Cell::new(s.step_number),
                Cell::new(weight_pct(s.target_weight)),
                Cell::new(state_badge(&s.status)),
                Cell::new(s.gate_expression.as_deref().unwrap_or("—")),
            ]);
        }
        println!("{st}");
    }

    if let Some(prompt) = d.baseline_prompt.as_deref() {
        if d.candidate_prompt.as_deref() != Some(prompt) {
            println!();
            println!(
                "{}",
                "Prompts differ between baseline and candidate.".dimmed()
            );
        }
    }

    Ok(())
}

// ── actions ─────────────────────────────────────────────────────────────────

pub async fn promote(client: &Client, id_or_name: &str) -> Result<()> {
    act(client, id_or_name, "promote", "Promoted").await
}

pub async fn rollback(client: &Client, id_or_name: &str) -> Result<()> {
    act(client, id_or_name, "rollback", "Rolled back").await
}

pub async fn pause(client: &Client, id_or_name: &str) -> Result<()> {
    act(client, id_or_name, "pause", "Paused").await
}

pub async fn resume(client: &Client, id_or_name: &str) -> Result<()> {
    act(client, id_or_name, "resume", "Resumed").await
}

async fn act(client: &Client, id_or_name: &str, action: &str, verb: &str) -> Result<()> {
    let res: MessageResponse = client
        .post(&format!("rollouts/{id_or_name}/{action}"), None)
        .await?;

    println!("{} {} {}", "✓".green().bold(), verb, id_or_name.bold());
    println!("  {}", res.message.dimmed());
    Ok(())
}

pub async fn delete(client: &Client, id_or_name: &str) -> Result<()> {
    let _: DeletedResponse = client.delete(&format!("rollouts/{id_or_name}")).await?;
    println!("{} Deleted {}", "✓".green().bold(), id_or_name.bold());
    Ok(())
}

// ── history ─────────────────────────────────────────────────────────────────

pub async fn history(client: &Client, id_or_name: &str) -> Result<()> {
    let list: DecisionList = client
        .get(&format!("rollouts/{id_or_name}/decisions"))
        .await?;

    if list.decisions.is_empty() {
        println!("{}", "No decisions recorded yet.".dimmed());
        println!(
            "{}",
            "The controller records one every cycle once traffic starts flowing.".dimmed()
        );
        return Ok(());
    }

    let mut table = make_table(vec!["WHEN", "ACTION", "WEIGHT", "BY", "REASON"]);
    for d in &list.decisions {
        let weight = match (d.previous_weight, d.new_weight) {
            (Some(p), Some(n)) => format!("{} → {}", weight_pct(p), weight_pct(n)),
            _ => "—".to_string(),
        };
        table.add_row(vec![
            Cell::new(relative_time(&d.created_at)),
            Cell::new(decision_action(&d.action)),
            Cell::new(weight),
            Cell::new(d.triggered_by.as_deref().unwrap_or("—")),
            Cell::new(d.reason.as_deref().unwrap_or("—")),
        ]);
    }

    println!("{table}");
    Ok(())
}

// ── formatting helpers ──────────────────────────────────────────────────────

fn opt_quality(v: Option<f64>) -> String {
    v.map(quality_score)
        .unwrap_or_else(|| "—".dimmed().to_string())
}

fn opt_ms(v: Option<i64>) -> String {
    v.map(|n| format!("{n} ms"))
        .unwrap_or_else(|| "—".dimmed().to_string())
}

fn opt_pct(v: Option<f64>) -> String {
    v.map(|n| format!("{:.2}%", n * 100.0))
        .unwrap_or_else(|| "—".dimmed().to_string())
}

fn opt_count(v: Option<i64>) -> String {
    v.map(|n| n.to_string())
        .unwrap_or_else(|| "—".dimmed().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_metrics_render_as_a_dash() {
        // Strip ANSI so the assertion does not depend on colour support.
        let plain = |s: String| String::from_utf8(strip_ansi(s.as_bytes())).unwrap();
        assert_eq!(plain(opt_quality(None)), "—");
        assert_eq!(plain(opt_ms(None)), "—");
        assert_eq!(plain(opt_pct(None)), "—");
        assert_eq!(plain(opt_count(None)), "—");
    }

    #[test]
    fn present_metrics_render_with_units() {
        assert_eq!(opt_ms(Some(120)), "120 ms");
        assert_eq!(opt_pct(Some(0.0123)), "1.23%");
        assert_eq!(opt_count(Some(42)), "42");
    }

    #[test]
    fn error_rate_of_zero_is_shown_not_hidden() {
        // 0% is a meaningful, good value — it must not be confused with "no data".
        assert_eq!(opt_pct(Some(0.0)), "0.00%");
    }

    /// Minimal ANSI escape stripper for assertions.
    fn strip_ansi(input: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(input.len());
        let mut i = 0;
        while i < input.len() {
            if input[i] == 0x1b {
                while i < input.len() && input[i] != b'm' {
                    i += 1;
                }
                i += 1;
            } else {
                out.push(input[i]);
                i += 1;
            }
        }
        out
    }
}
