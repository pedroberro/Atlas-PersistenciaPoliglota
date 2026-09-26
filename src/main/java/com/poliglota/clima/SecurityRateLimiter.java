package com.poliglota.clima;

import java.time.Duration;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
class SecurityRateLimiter {
    private static final Logger log = LoggerFactory.getLogger(SecurityRateLimiter.class);
    private static final DefaultRedisScript<Long> SCRIPT = new DefaultRedisScript<>(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n", Long.class);
    private final StringRedisTemplate redis;

    SecurityRateLimiter(StringRedisTemplate redis) { this.redis = redis; }

    void check(String scope, String identity, int maxRequests, Duration window) {
        String key = "rate:" + scope + ":" + SecurityConfig.sha256(identity);
        Long count;
        try { count = redis.execute(SCRIPT, List.of(key), Long.toString(window.toSeconds())); }
        catch (RuntimeException ex) {
            log.error("Rate limiter unavailable for {}", scope, ex);
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Security check unavailable");
        }
        if (count == null) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Security check unavailable");
        if (count > maxRequests) {
            log.warn("Rate limit exceeded for {}", scope);
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many requests; try again later");
        }
    }
}
