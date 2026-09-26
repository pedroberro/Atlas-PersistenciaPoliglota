package com.poliglota.clima;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import jakarta.servlet.http.HttpServletRequest;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
class AuthController {
    private static final Logger log = LoggerFactory.getLogger(AuthController.class);
    private final JdbcTemplate db;
    private final StringRedisTemplate redis;
    private final PasswordEncoder encoder;
    private final SecurityRateLimiter limiter;
    private final String dummyHash;
    private final int sessionHours;
    private final SecureRandom random = new SecureRandom();
    AuthController(JdbcTemplate db, StringRedisTemplate redis, PasswordEncoder encoder, SecurityRateLimiter limiter, @Value("${app.session-hours}") int sessionHours) {
        this.db = db; this.redis = redis; this.encoder = encoder; this.limiter = limiter; this.sessionHours = sessionHours;
        this.dummyHash = encoder.encode("constant dummy password");
    }
    record Register(@NotBlank @Size(max=200) String fullName, @Email @NotBlank @Size(max=320) String email, @NotBlank @Size(min=6,max=256) String password) {}
    record Login(@Email @NotBlank @Size(max=320) String email, @NotBlank @Size(max=4096) String password) {}
    @PostMapping("/register") @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Map<String,Object> register(@Valid @RequestBody Register input,HttpServletRequest request) {
        limiter.check("register-ip",request.getRemoteAddr(),10,Duration.ofHours(1));
        if (input.password().getBytes(StandardCharsets.UTF_8).length > 72)
            throw new IllegalArgumentException("Password exceeds BCrypt's 72-byte limit");
        UUID id = UUID.randomUUID();
        db.update("INSERT INTO users(id,full_name,email,password_hash) VALUES (?,?,?,?)", id, input.fullName().trim(), input.email().trim().toLowerCase(Locale.ROOT), encoder.encode(input.password()));
        db.update("INSERT INTO user_roles(user_id,role_name) VALUES (?,'USER')", id);
        log.info("Account registered userId={}",id);
        return Map.of("id", id, "role", "USER");
    }
    @PostMapping("/login")
    public Map<String,Object> login(@Valid @RequestBody Login input,HttpServletRequest request) {
        String email=input.email().trim().toLowerCase(Locale.ROOT);
        limiter.check("login-ip",request.getRemoteAddr(),100,Duration.ofMinutes(15));
        limiter.check("login-email",email,20,Duration.ofMinutes(15));
        var users = db.query("SELECT id,password_hash,active FROM users WHERE email=?", (rs,n) -> Map.<String,Object>of("id", rs.getObject("id", UUID.class), "hash", rs.getString("password_hash"), "active", rs.getBoolean("active")), email);
        String hash=users.isEmpty()?dummyHash:(String)users.getFirst().get("hash");
        boolean passwordMatches=encoder.matches(input.password(),hash);
        if (users.isEmpty() || !((boolean) users.getFirst().get("active")) || !passwordMatches) {
            log.warn("Login failed");
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
        }
        UUID userId = (UUID) users.getFirst().get("id");
        String role = db.query("SELECT role_name FROM user_roles WHERE user_id=?", (rs,n) -> rs.getString(1), userId)
            .stream().findFirst().orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN, "Role not assigned"));
        UUID sessionId = UUID.randomUUID();
        Instant now = Instant.now();
        Instant expiry = now.plus(Duration.ofHours(sessionHours));
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        db.update("INSERT INTO sessions(id,user_id,role_name,started_at,expires_at) VALUES (?,?,?,?,?)", sessionId, userId, role, java.sql.Timestamp.from(now), java.sql.Timestamp.from(expiry));
        try { redis.opsForValue().set(SecurityConfig.tokenKey(token), sessionId + ":" + userId + ":" + role, Duration.ofHours(sessionHours)); }
        catch (RuntimeException ex) { db.update("UPDATE sessions SET closed_at=now() WHERE id=?", sessionId); throw ex; }
        log.info("Login succeeded userId={} sessionId={}",userId,sessionId);
        return Map.of("token", token, "sessionId", sessionId, "role", role, "expiresAt", expiry);
    }
    @PostMapping("/logout")
    public void logout(@RequestHeader("Authorization") String header, Authentication auth) {
        if (!header.startsWith("Bearer ") || !SecurityConfig.validBearer(header.substring(7))) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Bearer token required");
        String key = SecurityConfig.tokenKey(header.substring(7));
        SecurityConfig.parseSession(redis.opsForValue().get(key)).filter(s->s.userId().toString().equals(auth.getName()))
            .ifPresent(s->db.update("UPDATE sessions SET closed_at=now() WHERE id=? AND closed_at IS NULL",s.sessionId()));
        redis.delete(key);
        log.info("Logout userId={}",auth.getName());
    }
    @GetMapping("/sessions")
    public List<Map<String,Object>> sessions(Authentication auth) {
        return db.queryForList("SELECT id,role_name,started_at,expires_at,closed_at FROM sessions WHERE user_id=? ORDER BY started_at DESC LIMIT 100", UUID.fromString(auth.getName()));
    }
    @Bean ApplicationRunner bootstrapAdmin(JdbcTemplate db, PasswordEncoder encoder, @Value("${app.bootstrap-admin-email}") String email, @Value("${app.bootstrap-admin-password}") String password) {
        return args -> {
            if (email.isBlank() || password.isBlank()) return;
            String normalized=email.trim().toLowerCase(Locale.ROOT);
            var existing=db.query("SELECT u.id,ur.role_name FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id WHERE u.email=?",
                (rs,n)->Map.<String,Object>of("id",rs.getObject(1,UUID.class),"role",rs.getString(2)==null?"":rs.getString(2)),normalized);
            if (!existing.isEmpty()) {
                if (!"ADMIN".equals(existing.getFirst().get("role")))
                    throw new IllegalStateException("Bootstrap admin email belongs to a non-admin account");
                return;
            }
            if (password.length() < 6) throw new IllegalStateException("Bootstrap password must have at least 6 characters");
            if (password.getBytes(StandardCharsets.UTF_8).length > 72) throw new IllegalStateException("Bootstrap password exceeds BCrypt's 72-byte limit");
            UUID id = UUID.randomUUID();
            db.update("INSERT INTO users(id,full_name,email,password_hash) VALUES (?,?,?,?)", id, "Administrator", normalized, encoder.encode(password));
            db.update("INSERT INTO user_roles(user_id,role_name) VALUES (?,'ADMIN')", id);
            log.info("Bootstrap administrator created userId={}",id);
        };
    }
}
