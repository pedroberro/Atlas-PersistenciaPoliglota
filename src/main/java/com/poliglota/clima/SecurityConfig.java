package com.poliglota.clima;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.UUID;
import java.util.Optional;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.filter.OncePerRequestFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.web.server.ResponseStatusException;

@Configuration
@EnableMethodSecurity
class SecurityConfig {
    record StoredSession(UUID sessionId, UUID userId, String role) {}
    static Optional<StoredSession> parseSession(String value) {
        if (value == null) return Optional.empty();
        String[] parts = value.split(":", -1);
        if (parts.length != 3 || !List.of("USER", "TECHNICIAN", "ADMIN").contains(parts[2])) return Optional.empty();
        try { return Optional.of(new StoredSession(UUID.fromString(parts[0]), UUID.fromString(parts[1]), parts[2])); }
        catch (IllegalArgumentException ex) { return Optional.empty(); }
    }
    static boolean validBearer(String token) { return token.matches("[A-Za-z0-9_-]{43}"); }
    static boolean sessionActive(JdbcTemplate jdbc, StoredSession stored) {
        Integer active = jdbc.queryForObject("SELECT count(*) FROM users u JOIN sessions s ON s.user_id=u.id JOIN user_roles ur ON ur.user_id=u.id AND ur.role_name=s.role_name WHERE u.id=? AND u.active AND s.id=? AND s.role_name=? AND s.closed_at IS NULL AND s.expires_at>now()", Integer.class, stored.userId(), stored.sessionId(), stored.role());
        return active != null && active == 1;
    }
    static String sha256(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException ex) { throw new IllegalStateException(ex); }
    }
    static String tokenKey(String token) { return "session:" + sha256(token); }
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }
    @Bean UserDetailsService users() { return username -> { throw new UsernameNotFoundException("Bearer authentication only"); }; }
    @Bean CorsConfigurationSource cors(@Value("${app.cors-origin}") String origin) {
        var config = new CorsConfiguration();
        config.setAllowedOrigins(List.of(origin));
        config.setAllowedMethods(List.of("GET", "POST", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
    @Bean SecurityFilterChain filterChain(HttpSecurity http, StringRedisTemplate redis, JdbcTemplate jdbc, SecurityRateLimiter limiter) throws Exception {
        var bearer = new OncePerRequestFilter() {
            @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
                if (request.getContentLengthLong() > 1_048_576) {
                    response.sendError(HttpStatus.PAYLOAD_TOO_LARGE.value());
                    return;
                }
                String path=request.getServletPath();
                if ("POST".equals(request.getMethod()) && (path.equals("/api/auth/login") || path.equals("/api/auth/register"))) {
                    try { limiter.check("auth-raw-ip",request.getRemoteAddr(),200,Duration.ofMinutes(15)); }
                    catch (ResponseStatusException ex) { response.sendError(ex.getStatusCode().value(),ex.getReason()); return; }
                }
                String header = request.getHeader("Authorization");
                if (header != null && header.startsWith("Bearer ") && validBearer(header.substring(7))) {
                    var session = parseSession(redis.opsForValue().get(tokenKey(header.substring(7))));
                    if (session.isPresent()) {
                        var stored = session.get();
                        if (sessionActive(jdbc,stored)) {
                            var auth = new UsernamePasswordAuthenticationToken(stored.userId().toString(), null, List.of(new SimpleGrantedAuthority("ROLE_" + stored.role())));
                            SecurityContextHolder.getContext().setAuthentication(auth);
                        }
                    }
                }
                chain.doFilter(request, response);
            }
        };
        http.csrf(c -> c.disable()).cors(Customizer.withDefaults()).httpBasic(c -> c.disable()).formLogin(c -> c.disable())
            .headers(h -> h.contentSecurityPolicy(c -> c.policyDirectives("default-src 'none'; frame-ancestors 'none'"))
                .referrerPolicy(r -> r.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER))
                .cacheControl(Customizer.withDefaults()))
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .exceptionHandling(e -> e.authenticationEntryPoint((req,res,ex) -> res.sendError(HttpStatus.UNAUTHORIZED.value())))
            .authorizeHttpRequests(a -> a.requestMatchers("/api/auth/register", "/api/auth/login", "/api/measurements/sensors/*/ingest", "/actuator/health").permitAll().anyRequest().authenticated())
            .addFilterBefore(bearer, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
