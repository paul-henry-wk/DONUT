use std::sync::Mutex;
use std::time::{Duration, Instant};

struct CacheEntry<T> {
    data: T,
    key: String,
    inserted_at: Instant,
}

pub(crate) struct TtlCache<T: Clone> {
    inner: Mutex<Option<CacheEntry<T>>>,
    ttl: Duration,
}

impl<T: Clone> TtlCache<T> {
    pub fn new(ttl_secs: u64) -> Self {
        Self {
            inner: Mutex::new(None),
            ttl: Duration::from_secs(ttl_secs),
        }
    }

    pub fn get(&self, key: &str) -> Option<T> {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = guard.as_ref() {
            if entry.key == key && entry.inserted_at.elapsed() < self.ttl {
                return Some(entry.data.clone());
            }
        }
        None
    }

    pub fn set(&self, key: &str, data: T) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(CacheEntry {
            data,
            key: key.to_string(),
            inserted_at: Instant::now(),
        });
    }

    #[allow(dead_code)]
    pub fn invalidate(&self) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        *guard = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_miss_when_empty() {
        let cache: TtlCache<String> = TtlCache::new(60);
        assert!(cache.get("key").is_none());
    }

    #[test]
    fn cache_hit_after_set() {
        let cache: TtlCache<String> = TtlCache::new(60);
        cache.set("key", "value".to_string());
        assert_eq!(cache.get("key").unwrap(), "value");
    }

    #[test]
    fn cache_miss_wrong_key() {
        let cache: TtlCache<String> = TtlCache::new(60);
        cache.set("key1", "value".to_string());
        assert!(cache.get("key2").is_none());
    }

    #[test]
    fn cache_expired() {
        let cache: TtlCache<String> = TtlCache::new(0); // 0s TTL = expires immediately
        cache.set("key", "value".to_string());
        std::thread::sleep(std::time::Duration::from_millis(10));
        assert!(cache.get("key").is_none());
    }

    #[test]
    fn cache_overwrite() {
        let cache: TtlCache<String> = TtlCache::new(60);
        cache.set("key", "old".to_string());
        cache.set("key", "new".to_string());
        assert_eq!(cache.get("key").unwrap(), "new");
    }

    #[test]
    fn cache_invalidate() {
        let cache: TtlCache<String> = TtlCache::new(60);
        cache.set("key", "value".to_string());
        cache.invalidate();
        assert!(cache.get("key").is_none());
    }

    #[test]
    fn cache_with_vec() {
        let cache: TtlCache<Vec<i32>> = TtlCache::new(60);
        cache.set("nums", vec![1, 2, 3]);
        assert_eq!(cache.get("nums").unwrap(), vec![1, 2, 3]);
    }
}
