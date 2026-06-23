// © TOMII, Tatsuru

use chrono::{DateTime, Local};
use std::fmt::Display;
use std::io::{self, IsTerminal, Write};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// 変換全体の開始時刻。全ステップを通算したトータル経過時間の基準。
static RUN_START: OnceLock<Instant> = OnceLock::new();

/// 変換全体の開始時刻を記録する。初回呼び出しのみ有効で、以降は無視される。
pub fn mark_run_start() {
    let _ = RUN_START.set(Instant::now());
}

/// 変換開始からの累積経過時間。未記録のときは 0 を返す。
fn total_elapsed() -> Duration {
    RUN_START.get().map(Instant::elapsed).unwrap_or_default()
}

pub struct ProgressDisplay {
    enabled: bool,
    interactive: bool,
    step_start: Instant,
    current: Option<String>,
}

impl ProgressDisplay {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            interactive: enabled && io::stderr().is_terminal(),
            step_start: Instant::now(),
            current: None,
        }
    }

    /// ステップ内の件数進捗を、トータル経過時間とステップの終了予測付きで上書き表示する。
    /// 終了予測はこのステップ自身の経過時間と done/total から呼び出しごとに再計算する。
    pub fn progress(&mut self, done: usize, total: usize, label: impl Display) {
        self.weighted_progress(done, total, done as f64, total as f64, label);
    }

    /// 件数表示は維持しつつ、ETAだけを処理コストの重みで計算する。
    pub fn weighted_progress(
        &mut self,
        done: usize,
        total: usize,
        done_weight: f64,
        total_weight: f64,
        label: impl Display,
    ) {
        if !self.interactive {
            return;
        }
        let mut line = format!(
            "{label} | {done}/{total} | total {}",
            format_elapsed(total_elapsed())
        );
        if let Some(remaining) =
            format_weighted_step_eta(self.step_start.elapsed(), done_weight, total_weight)
        {
            line.push_str(&format!(
                " | eta 残り {} (終了 {})",
                format_elapsed(remaining),
                completion_clock(Local::now(), remaining)
            ));
        }
        self.current = Some(line);
        self.draw();
    }

    pub fn message(&mut self, message: impl Display) {
        if !self.enabled {
            return;
        }
        if self.interactive {
            self.clear();
        }
        eprintln!("{message}");
        if self.interactive {
            self.draw();
        }
    }

    fn draw(&self) {
        if let Some(current) = &self.current {
            let mut stderr = io::stderr().lock();
            let _ = write!(stderr, "\r\x1b[2K{current}");
            let _ = stderr.flush();
        }
    }

    fn clear(&self) {
        if self.interactive {
            let mut stderr = io::stderr().lock();
            let _ = write!(stderr, "\r\x1b[2K");
            let _ = stderr.flush();
        }
    }
}

impl Drop for ProgressDisplay {
    fn drop(&mut self) {
        self.clear();
    }
}

pub fn timed<T>(description: &str, operation: impl FnOnce() -> T) -> T {
    eprintln!("{description}");
    let started = Instant::now();
    let result = operation();
    eprintln!("elapsed: {}", format_elapsed(started.elapsed()));
    result
}

/// 経過時間を大きさに応じて秒・分・時間の単位で整形する。
/// 60秒未満は秒のみ（ミリ秒精度）、1時間未満は分秒、1時間以上は時分秒で表示する。
fn format_elapsed(elapsed: Duration) -> String {
    let total_secs = elapsed.as_secs_f64();
    if total_secs < 60.0 {
        return format!("{total_secs:.3}s");
    }
    let whole_secs = elapsed.as_secs();
    let seconds = whole_secs % 60;
    let minutes = (whole_secs / 60) % 60;
    let hours = whole_secs / 3600;
    if hours == 0 {
        format!("{minutes}m {seconds:02}s")
    } else {
        format!("{hours}h {minutes:02}m {seconds:02}s")
    }
}

/// ステップの残り時間を、これまでの経過時間と重み付き進捗から線形外挿する。
/// 重みが進んでいないときは推定不能として None を返す。
fn format_weighted_step_eta(
    step_elapsed: Duration,
    done_weight: f64,
    total_weight: f64,
) -> Option<Duration> {
    if done_weight <= 0.0
        || total_weight < done_weight
        || !done_weight.is_finite()
        || !total_weight.is_finite()
    {
        return None;
    }
    Some(step_elapsed.mul_f64((total_weight - done_weight) / done_weight))
}

/// 現在時刻に残り時間を加えた終了予測時刻を時:分:秒で整形する。
fn completion_clock(now: DateTime<Local>, remaining: Duration) -> String {
    let delta = chrono::TimeDelta::from_std(remaining).unwrap_or_default();
    (now + delta).format("%H:%M:%S").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn formats_sub_minute_with_millisecond_precision() {
        assert_eq!(format_elapsed(Duration::from_millis(500)), "0.500s");
        assert_eq!(format_elapsed(Duration::from_millis(12_345)), "12.345s");
    }

    #[test]
    fn formats_minutes_and_seconds() {
        assert_eq!(format_elapsed(Duration::from_secs(60)), "1m 00s");
        assert_eq!(format_elapsed(Duration::from_secs(125)), "2m 05s");
    }

    #[test]
    fn formats_hours_minutes_and_seconds() {
        assert_eq!(format_elapsed(Duration::from_secs(3600)), "1h 00m 00s");
        assert_eq!(format_elapsed(Duration::from_secs(3723)), "1h 02m 03s");
    }

    #[test]
    fn step_eta_is_none_before_any_progress() {
        assert_eq!(
            format_weighted_step_eta(Duration::from_secs(10), 0.0, 10.0),
            None
        );
    }

    #[test]
    fn step_eta_extrapolates_from_done_ratio() {
        assert_eq!(
            format_weighted_step_eta(Duration::from_secs(10), 5.0, 10.0),
            Some(Duration::from_secs(10))
        );
        assert_eq!(
            format_weighted_step_eta(Duration::from_secs(30), 3.0, 4.0),
            Some(Duration::from_secs(10))
        );
    }

    #[test]
    fn step_eta_is_zero_when_complete() {
        assert_eq!(
            format_weighted_step_eta(Duration::from_secs(10), 10.0, 10.0),
            Some(Duration::ZERO)
        );
    }

    #[test]
    fn weighted_step_eta_extrapolates_from_weight_ratio() {
        assert_eq!(
            format_weighted_step_eta(Duration::from_secs(10), 1.0, 1.25),
            Some(Duration::from_millis(2500))
        );
    }

    #[test]
    fn weighted_step_eta_rejects_invalid_weight() {
        assert_eq!(
            format_weighted_step_eta(Duration::from_secs(10), 0.0, 1.0),
            None
        );
        assert_eq!(
            format_weighted_step_eta(Duration::from_secs(10), 2.0, 1.0),
            None
        );
    }

    #[test]
    fn completion_clock_adds_remaining_to_now() {
        let now = Local
            .with_ymd_and_hms(2026, 6, 18, 14, 30, 0)
            .single()
            .expect("valid local time");
        assert_eq!(completion_clock(now, Duration::from_secs(125)), "14:32:05");
    }
}
