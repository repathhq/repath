//! Terminal output helpers — tables, status badges, progress indicators.
//!
//! All output functions write to stdout. Errors go to stderr (handled in main).
//! Colors are automatically disabled when stdout is not a terminal (e.g., when
//! piping to grep or a file).

use chrono::{DateTime, Utc};
use colored::Colorize;
use comfy_table::{
    modifiers::UTF8_ROUND_CORNERS, presets::UTF8_FULL, Attribute, Cell, Color, ContentArrangement,
    Table,
};

/// Format a rollout state string as a coloured badge.
pub fn state_badge(state: &str) -> String {
    match state {
        "canary" => format!(" {state} ").black().on_yellow().bold().to_string(),
        "shadow" => format!(" {state} ").black().on_blue().bold().to_string(),
        "promoted" => format!(" {state} ").black().on_green().bold().to_string(),
        "rolled_back" => format!(" {state} ").white().on_red().bold().to_string(),
        "created" => format!(" {state} ")
            .black()
            .on_bright_black()
            .bold()
            .to_string(),
        "paused" => format!(" {state} ").black().on_white().bold().to_string(),
        other => format!(" {other} ").normal().to_string(),
    }
}

/// Format a weight (0.0 – 1.0) as a percentage string.
pub fn weight_pct(weight: f64) -> String {
    format!("{:.0}%", weight * 100.0)
}

/// Format a quality score as a coloured string.
pub fn quality_score(score: f64) -> String {
    let s = format!("{:.3}", score);
    if score >= 0.9 {
        s.green().to_string()
    } else if score >= 0.7 {
        s.yellow().to_string()
    } else {
        s.red().to_string()
    }
}

/// Format a decision action as a coloured string.
pub fn decision_action(action: &str) -> String {
    match action {
        "advance" => action.green().to_string(),
        "promote" => "promote".bright_green().bold().to_string(),
        "rollback" => action.red().bold().to_string(),
        "pause" | "resume" => action.yellow().to_string(),
        _ => action.normal().to_string(),
    }
}

/// Format a UTC timestamp as a human-readable relative time.
pub fn relative_time(dt: &DateTime<Utc>) -> String {
    let now = Utc::now();
    let secs = (now - *dt).num_seconds().max(0);

    if secs < 60 {
        format!("{}s ago", secs)
    } else if secs < 3600 {
        format!("{}m ago", secs / 60)
    } else if secs < 86400 {
        format!("{}h ago", secs / 3600)
    } else {
        format!("{}d ago", secs / 86400)
    }
}

/// Build a standard table with rounded UTF-8 borders.
pub fn make_table(headers: Vec<&str>) -> Table {
    let mut table = Table::new();
    table
        .load_preset(UTF8_FULL)
        .apply_modifier(UTF8_ROUND_CORNERS)
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(
            headers
                .iter()
                .map(|h| Cell::new(h).add_attribute(Attribute::Bold).fg(Color::Cyan))
                .collect::<Vec<_>>(),
        );
    table
}

/// Print a section header.
pub fn section(title: &str) {
    println!("\n{}", title.bold().underline());
}

/// Print a key-value pair with alignment.
pub fn kv(key: &str, value: &str) {
    println!("  {:<22} {}", format!("{}:", key).dimmed(), value);
}

/// Draw a traffic split bar, e.g.:
/// Baseline  [████████████████░░░░]  80%
/// Candidate [░░░░████████████████]  20%
pub fn traffic_bar(label: &str, weight: f64, bar_width: usize) {
    let filled = (weight * bar_width as f64).round() as usize;
    let empty = bar_width.saturating_sub(filled);
    let bar = format!(
        "{}{}",
        "█".repeat(filled).green(),
        "░".repeat(empty).dimmed(),
    );
    println!("  {:<12} [{}]  {}", label, bar, weight_pct(weight).bold(),);
}
