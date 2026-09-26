package com.poliglota.clima;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.time.Duration;
import java.util.UUID;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.server.ResponseStatusException;

class SecurityHardeningTest {
    @Test void malformedOrUnexpectedSessionCannotProvideAuthority() {
        String id = UUID.randomUUID().toString();
        assertTrue(SecurityConfig.parseSession(null).isEmpty());
        assertTrue(SecurityConfig.parseSession("invalid:" + id + ":ADMIN").isEmpty());
        assertTrue(SecurityConfig.parseSession(id + ":" + id + ":SUPERUSER").isEmpty());
        assertTrue(SecurityConfig.parseSession(id + ":" + id + ":ADMIN:extra").isEmpty());
        assertEquals("ADMIN", SecurityConfig.parseSession(id + ":" + id + ":ADMIN").orElseThrow().role());
        assertFalse(SecurityConfig.validBearer("oversized or invalid bearer value"));
    }

    @Test void cachedRoleMustMatchTheDatabaseSessionRole() {
        var db = mock(JdbcTemplate.class);
        var session = new SecurityConfig.StoredSession(UUID.randomUUID(), UUID.randomUUID(), "ADMIN");
        when(db.queryForObject(contains("s.role_name=?"), eq(Integer.class),
            eq(session.userId()), eq(session.sessionId()), eq(session.role()))).thenReturn(0);

        assertFalse(SecurityConfig.sessionActive(db, session));
        verify(db).queryForObject(contains("s.role_name=?"), eq(Integer.class),
            eq(session.userId()), eq(session.sessionId()), eq("ADMIN"));
    }

    @Test void rateLimiterRejectsExcessAndFailsClosedWhenRedisIsUnavailable() {
        var redis = mock(StringRedisTemplate.class);
        var limiter = new SecurityRateLimiter(redis);
        when(redis.execute(any(), anyList(), anyString())).thenReturn(1L, 2L)
            .thenThrow(new IllegalStateException("redis unavailable"));
        limiter.check("login-email", "user@example.com", 1, Duration.ofMinutes(15));
        ResponseStatusException limited = assertThrows(ResponseStatusException.class,
            () -> limiter.check("login-email", "user@example.com", 1, Duration.ofMinutes(15)));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, limited.getStatusCode());
        ResponseStatusException unavailable = assertThrows(ResponseStatusException.class,
            () -> limiter.check("login-email", "user@example.com", 1, Duration.ofMinutes(15)));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, unavailable.getStatusCode());
    }

    @Test void bootstrapCannotPromoteAnExistingPublicAccount() throws Exception {
        var db = mock(JdbcTemplate.class);
        var encoder = mock(PasswordEncoder.class);
        var auth = new AuthController(db, mock(StringRedisTemplate.class), encoder,
            mock(SecurityRateLimiter.class), 12);
        when(db.query(anyString(), any(RowMapper.class), eq("admin@example.com")))
            .thenReturn(List.of(Map.of("id", UUID.randomUUID(), "role", "USER")));

        assertThrows(IllegalStateException.class,
            () -> auth.bootstrapAdmin(db, encoder, "admin@example.com", "a-long-bootstrap-password").run(null));
        verify(db, never()).update(anyString(), any(), any(), any());
    }
}
