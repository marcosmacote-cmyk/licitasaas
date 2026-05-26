/**
 * ══════════════════════════════════════════════════════════════
 *  Simple TTL Cache — In-memory caching with Time-To-Live
 * ══════════════════════════════════════════════════════════════
 */
export class SimpleTtlCache<K = string, V = any> {
    private cache = new Map<K, { value: V; expiresAt: number }>();
    private defaultTtlMs: number;

    constructor(defaultTtlSeconds = 1800) {
        this.defaultTtlMs = defaultTtlSeconds * 1000;
    }

    get(key: K): V | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return undefined;
        }
        return entry.value;
    }

    set(key: K, value: V, ttlSeconds?: number): void {
        const ttlMs = ttlSeconds !== undefined ? ttlSeconds * 1000 : this.defaultTtlMs;
        this.cache.set(key, {
            value,
            expiresAt: Date.now() + ttlMs
        });
    }

    delete(key: K): boolean {
        return this.cache.delete(key);
    }

    flushAll(): void {
        this.cache.clear();
    }

    /**
     * Flush cache keys matching a pattern/prefix.
     */
    flushPattern(predicate: (key: K) => boolean): void {
        for (const key of this.cache.keys()) {
            if (predicate(key)) {
                this.cache.delete(key);
            }
        }
    }
}
