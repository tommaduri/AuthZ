use cretoai_authz::engine::PolicyEngine;
use std::sync::Arc;
use std::time::Instant;

/// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    /// Authorization policy engine
    pub engine: Arc<PolicyEngine>,

    /// Server start time for uptime calculation
    pub start_time: Instant,

    /// Application version
    pub version: String,

    /// Build time
    pub build_time: String,

    /// Git commit hash
    pub git_commit: String,
}

impl AppState {
    pub fn new(engine: PolicyEngine) -> Self {
        Self {
            engine: Arc::new(engine),
            start_time: Instant::now(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            build_time: env!("BUILD_TIME").unwrap_or("unknown").to_string(),
            git_commit: env!("GIT_COMMIT").unwrap_or("unknown").to_string(),
        }
    }

    pub fn uptime_seconds(&self) -> u64 {
        self.start_time.elapsed().as_secs()
    }
}
