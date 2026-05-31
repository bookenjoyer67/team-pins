use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use std::time::Duration;

use futures_util::FutureExt;
use tokio::sync::broadcast;
use tokio::task::JoinSet;
use tracing::{error, info};

const RESTART_DELAY_MS: u64 = 2500;

pub struct ServiceManager {
    tasks: tokio::sync::Mutex<JoinSet<()>>,
    shutdown_tx: broadcast::Sender<()>,
}

impl ServiceManager {
    pub fn new() -> Self {
        let (shutdown_tx, _) = broadcast::channel(16);
        Self {
            tasks: tokio::sync::Mutex::new(JoinSet::new()),
            shutdown_tx,
        }
    }

    pub fn shutdown_signal(&self) -> broadcast::Receiver<()> {
        self.shutdown_tx.subscribe()
    }

    /// Spawn a task that restarts on panic after a delay.
    pub async fn spawn_restartable<F, Fut>(&self, name: &str, factory: F)
    where
        F: Fn(broadcast::Receiver<()>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let factory = Arc::new(factory);
        let task_name = name.to_string();
        let shutdown_rx = self.shutdown_tx.subscribe();

        self.tasks.lock().await.spawn(async move {
            let mut rx = shutdown_rx;
            loop {
                let fut = factory(rx.resubscribe());
                tokio::select! {
                    _ = rx.recv() => {
                        info!("[manager] {} shutting down", task_name);
                        break;
                    }
                    result = AssertUnwindSafe(fut).catch_unwind() => {
                        match result {
                            Ok(()) => {
                                info!("[manager] {} completed", task_name);
                                break;
                            }
                            Err(e) => {
                                let msg = panic_message(&e);
                                error!("[manager] {} panicked: {}. Restarting in {}ms",
                                    task_name, msg, RESTART_DELAY_MS);
                                tokio::time::sleep(Duration::from_millis(RESTART_DELAY_MS)).await;
                            }
                        }
                    }
                }
            }
        });
    }

    /// Spawn a fire-and-forget task (no restart on panic).
    pub async fn spawn_one<F>(&self, name: &str, future: F)
    where
        F: Future<Output = ()> + Send + 'static,
    {
        let task_name = name.to_string();
        let mut rx = self.shutdown_tx.subscribe();

        self.tasks.lock().await.spawn(async move {
            tokio::select! {
                _ = rx.recv() => {
                    info!("[manager] {} shutting down", task_name);
                }
                result = AssertUnwindSafe(future).catch_unwind() => {
                    match result {
                        Ok(()) => info!("[manager] {} completed", task_name),
                        Err(e) => {
                            let msg = panic_message(&e);
                            error!("[manager] {} panicked: {}", task_name, msg);
                        }
                    }
                }
            }
        });
    }

    /// Initiate graceful shutdown. Awaits tasks then aborts remainder.
    pub async fn shutdown(&self, timeout: Duration) {
        let _ = self.shutdown_tx.send(());
        let mut tasks = self.tasks.lock().await;
        info!("[manager] waiting for {} tasks to shut down...", tasks.len());
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if tokio::time::Instant::now() >= deadline {
                break;
            }
            match tokio::time::timeout(Duration::from_secs(1), tasks.join_next()).await {
                Ok(Some(Err(e))) => {
                    let msg = join_error_msg(&e);
                    error!("[manager] task failed during shutdown: {}", msg);
                }
                Ok(Some(Ok(()))) => {}
                Ok(None) => break,
                Err(_timeout) => continue,
            }
        }
        let remaining = tasks.len();
        if remaining > 0 {
            tasks.abort_all();
            info!("[manager] aborted {} tasks after timeout", remaining);
        }
        drop(tasks);
        info!("[manager] shutdown complete");
    }
}

fn panic_message(e: &Box<dyn std::any::Any + Send>) -> String {
    e.downcast_ref::<&str>().copied()
        .or_else(|| e.downcast_ref::<String>().map(|s| s.as_str()))
        .unwrap_or("unknown panic")
        .to_string()
}

fn join_error_msg(e: &tokio::task::JoinError) -> String {
    if e.is_panic() {
        return "task panicked".to_string();
    }
    if e.is_cancelled() {
        return "task cancelled".to_string();
    }
    e.to_string()
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    use super::*;

    #[tokio::test]
    async fn test_restartable_restarts_after_panic() {
        let mgr = ServiceManager::new();
        let counter = Arc::new(AtomicU32::new(0));
        let c = counter.clone();
        mgr.spawn_restartable("test", move |mut _rx| {
            let c = c.clone();
            async move {
                c.fetch_add(1, Ordering::Relaxed);
                if c.load(Ordering::Relaxed) < 2 {
                    panic!("intentional panic for restart test");
                }
            }
        }).await;
        tokio::time::sleep(Duration::from_millis(3000)).await;
        mgr.shutdown(Duration::from_secs(1)).await;
        assert!(counter.load(Ordering::Relaxed) >= 2);
    }

    #[tokio::test]
    async fn test_restartable_exits_on_shutdown() {
        let mgr = ServiceManager::new();
        mgr.spawn_restartable("test", move |mut rx| async move {
            tokio::select! {
                _ = rx.recv() => {}
                _ = tokio::time::sleep(Duration::from_secs(999)) => {}
            }
        }).await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        // Shutdown should complete quickly (not hang)
        let result = tokio::time::timeout(Duration::from_secs(3), mgr.shutdown(Duration::from_secs(1))).await;
        assert!(result.is_ok(), "shutdown should complete within timeout");
    }

    #[tokio::test]
    async fn test_storm_mode_shutdown_still_works() {
        let mgr = ServiceManager::new();
        let panic_count = Arc::new(AtomicU32::new(0));
        let pc = panic_count.clone();
        mgr.spawn_restartable("storm", move |_rx| {
            let pc = pc.clone();
            async move {
                pc.fetch_add(1, Ordering::Relaxed);
                panic!("storm panic");
            }
        }).await;
        // Let it panic and restart a few times
        tokio::time::sleep(Duration::from_millis(200)).await;
        // Shutdown should work even during storm
        let result = tokio::time::timeout(Duration::from_secs(5), mgr.shutdown(Duration::from_secs(2))).await;
        assert!(result.is_ok(), "shutdown should work during storm");
        assert!(panic_count.load(Ordering::Relaxed) >= 1, "should have panicked at least once");
    }
}
