package com.poliglota.clima;

import jakarta.validation.Valid;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

@RestController
@RequestMapping("/api/measurements")
class MeasurementController {
    private final MeasurementService service;
    private final JdbcTemplate db;
    private final SecurityRateLimiter limiter;
    MeasurementController(MeasurementService service,JdbcTemplate db,SecurityRateLimiter limiter) { this.service=service; this.db=db; this.limiter=limiter; }
    @PostMapping("/sensors/{sensorId}") @ResponseStatus(HttpStatus.CREATED) @PreAuthorize("hasAnyRole('TECHNICIAN','ADMIN')")
    MeasurementService.Measurement create(@PathVariable UUID sensorId,@Valid @RequestBody MeasurementService.Reading input) { return service.ingest(sensorId,input); }
    @PostMapping("/sensors/{sensorId}/ingest") @ResponseStatus(HttpStatus.CREATED)
    MeasurementService.Measurement deviceIngest(@PathVariable UUID sensorId,@RequestHeader(value="X-Sensor-Key",required=false) String key,@Valid @RequestBody MeasurementService.Reading input,HttpServletRequest request) {
        limiter.check("ingest-ip",request.getRemoteAddr(),300,Duration.ofMinutes(1));
        limiter.check("ingest-sensor",sensorId.toString(),120,Duration.ofMinutes(1));
        if (key==null || key.length()>200) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Valid sensor key required");
        var hashes=db.query("SELECT key_hash FROM sensor_credentials WHERE sensor_id=?",(rs,n)->rs.getString(1),sensorId);
        if (hashes.isEmpty() || !MessageDigest.isEqual(SecurityConfig.sha256(key).getBytes(StandardCharsets.US_ASCII),hashes.getFirst().getBytes(StandardCharsets.US_ASCII)))
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Valid sensor key required");
        return service.ingest(sensorId,input);
    }
    @GetMapping
    List<MeasurementService.Measurement> query(@RequestParam String scopeType,@RequestParam String scopeKey,@RequestParam Instant from,@RequestParam Instant to) {
        return service.query(scopeType.toUpperCase(),scopeKey,from,to);
    }
}
