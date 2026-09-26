package com.poliglota.clima;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;

@RestController
@RequestMapping("/api/sensors")
class SensorController {
    private static final Logger log = LoggerFactory.getLogger(SensorController.class);
    private final JdbcTemplate db;
    private final AlertService alerts;
    private final SecureRandom random=new SecureRandom();
    SensorController(JdbcTemplate db, AlertService alerts) { this.db = db; this.alerts = alerts; }
    record SensorInput(@NotBlank @Size(max=80) String code, @NotBlank String sensorType, @NotNull @DecimalMin("-90") @DecimalMax("90") BigDecimal latitude,
        @NotNull @DecimalMin("-180") @DecimalMax("180") BigDecimal longitude, @NotBlank @Size(max=120) String city, @NotBlank @Size(max=120) String zone,
        @NotBlank @Size(max=120) String country, BigDecimal minTemperature, BigDecimal maxTemperature, BigDecimal minHumidity, BigDecimal maxHumidity) {}
    record ControlInput(@NotBlank String status, @Size(max=2000) String notes) {}
    @PostMapping @ResponseStatus(HttpStatus.CREATED) @PreAuthorize("hasAnyRole('TECHNICIAN','ADMIN')") @Transactional
    Map<String,Object> create(@Valid @RequestBody SensorInput in) {
        if (!List.of("TEMPERATURE","HUMIDITY","BOTH").contains(in.sensorType())) throw new IllegalArgumentException("Invalid sensor type");
        if (in.minTemperature()!=null && in.maxTemperature()!=null && in.minTemperature().compareTo(in.maxTemperature())>=0) throw new IllegalArgumentException("Invalid temperature thresholds");
        if (in.minHumidity()!=null && in.maxHumidity()!=null && in.minHumidity().compareTo(in.maxHumidity())>=0) throw new IllegalArgumentException("Invalid humidity thresholds");
        UUID id = UUID.randomUUID();
        db.update("INSERT INTO sensors(id,code,sensor_type,latitude,longitude,city,zone,country,status,started_at,min_temperature,max_temperature,min_humidity,max_humidity) VALUES (?,?,?,?,?,?,?,?,'ACTIVE',now(),?,?,?,?)",
            id,in.code().trim(),in.sensorType(),in.latitude(),in.longitude(),in.city().trim(),in.zone().trim(),in.country().trim(),in.minTemperature(),in.maxTemperature(),in.minHumidity(),in.maxHumidity());
        return Map.of("id", id,"sensorKey",setKey(id));
    }
    @PostMapping("/{id}/key") @PreAuthorize("hasAnyRole('TECHNICIAN','ADMIN')")
    Map<String,Object> rotateKey(@PathVariable UUID id,Authentication auth) {
        Integer exists=db.queryForObject("SELECT count(*) FROM sensors WHERE id=?",Integer.class,id);
        if (exists==null || exists==0) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Sensor not found");
        String key=setKey(id);
        log.info("Sensor key rotated actorId={} sensorId={}",auth.getName(),id);
        return Map.of("sensorKey",key);
    }
    private String setKey(UUID id) {
        byte[] bytes=new byte[32]; random.nextBytes(bytes);
        String key=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        db.update("INSERT INTO sensor_credentials(sensor_id,key_hash,rotated_at) VALUES (?,?,now()) ON CONFLICT(sensor_id) DO UPDATE SET key_hash=excluded.key_hash,rotated_at=now()",id,SecurityConfig.sha256(key));
        return key;
    }
    @GetMapping
    List<Map<String,Object>> list(@RequestParam(required=false) String country, @RequestParam(required=false) String zone, @RequestParam(required=false) String city) {
        return db.queryForList("SELECT * FROM sensors WHERE (CAST(? AS text) IS NULL OR lower(country)=lower(?)) AND (CAST(? AS text) IS NULL OR lower(zone)=lower(?)) AND (CAST(? AS text) IS NULL OR lower(city)=lower(?)) ORDER BY country,zone,city,code LIMIT 500",
            country,country,zone,zone,city,city);
    }
    @PostMapping("/{id}/controls") @ResponseStatus(HttpStatus.CREATED) @PreAuthorize("hasAnyRole('TECHNICIAN','ADMIN')") @Transactional
    Map<String,Object> control(@PathVariable UUID id, @Valid @RequestBody ControlInput in, Authentication auth) {
        if (!List.of("ACTIVE","INACTIVE","FAULT").contains(in.status())) throw new IllegalArgumentException("Invalid sensor status");
        int updated = db.update("UPDATE sensors SET status=? WHERE id=?", in.status(), id);
        if (updated==0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Sensor not found");
        UUID controlId = UUID.randomUUID();
        db.update("INSERT INTO sensor_controls(id,sensor_id,reviewed_at,status,notes,technician_id) VALUES (?,?,now(),?,?,?)",controlId,id,in.status(),in.notes(),UUID.fromString(auth.getName()));
        if (in.status().equals("FAULT")) alerts.sensorAlert(id, "Sensor marked as faulty: " + (in.notes()==null ? "" : in.notes()));
        else alerts.resolveSensorAlerts(id);
        return Map.of("id",controlId);
    }
    @GetMapping("/{id}/controls") @PreAuthorize("hasAnyRole('TECHNICIAN','ADMIN')")
    List<Map<String,Object>> controls(@PathVariable UUID id) {
        return db.queryForList("SELECT * FROM sensor_controls WHERE sensor_id=? ORDER BY reviewed_at DESC LIMIT 100",id);
    }
}
