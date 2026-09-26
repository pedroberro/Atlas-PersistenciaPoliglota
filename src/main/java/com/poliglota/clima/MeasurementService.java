package com.poliglota.clima;

import com.datastax.oss.driver.api.core.CqlSession;
import com.datastax.oss.driver.api.core.cql.Row;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
class MeasurementService {
    private final JdbcTemplate db;
    private final CqlSession cassandra;
    private final AlertService alerts;
    MeasurementService(JdbcTemplate db, CqlSession cassandra, AlertService alerts) { this.db=db; this.cassandra=cassandra; this.alerts=alerts; }
    record Reading(UUID measurementId,@NotNull Instant measuredAt, BigDecimal temperature, BigDecimal humidity) {}
    record Measurement(UUID id, UUID sensorId, Instant measuredAt, BigDecimal temperature, BigDecimal humidity) {}
    private record Sensor(UUID id, String type, String city, String zone, String country, String status,
        BigDecimal minTemperature, BigDecimal maxTemperature, BigDecimal minHumidity, BigDecimal maxHumidity) {}
    Measurement ingest(UUID sensorId, Reading input) {
        var sensors = db.query("SELECT * FROM sensors WHERE id=?",(rs,n)->new Sensor(sensorId,rs.getString("sensor_type"),rs.getString("city"),rs.getString("zone"),rs.getString("country"),rs.getString("status"),rs.getBigDecimal("min_temperature"),rs.getBigDecimal("max_temperature"),rs.getBigDecimal("min_humidity"),rs.getBigDecimal("max_humidity")),sensorId);
        if (sensors.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Sensor not found");
        Sensor sensor=sensors.getFirst();
        if (!sensor.status().equals("ACTIVE")) throw new ResponseStatusException(HttpStatus.CONFLICT,"Sensor is not active");
        if (input.measuredAt().isAfter(Instant.now().plusSeconds(300))) throw new IllegalArgumentException("Measurement cannot be in the future");
        if (input.temperature()==null && input.humidity()==null) throw new IllegalArgumentException("At least one value is required");
        if (input.humidity()!=null && (input.humidity().compareTo(BigDecimal.ZERO)<0 || input.humidity().compareTo(BigDecimal.valueOf(100))>0)) throw new IllegalArgumentException("Humidity must be 0..100");
        if (sensor.type().equals("TEMPERATURE") && input.humidity()!=null || sensor.type().equals("HUMIDITY") && input.temperature()!=null) throw new IllegalArgumentException("Value does not match sensor type");
        UUID id=input.measurementId()==null?UUID.randomUUID():input.measurementId();
        String bucket=YearMonth.from(input.measuredAt().atZone(ZoneOffset.UTC)).toString();
        for (String[] scope : List.of(new String[]{"CITY",sensor.country()+"/"+sensor.zone()+"/"+sensor.city()},new String[]{"ZONE",sensor.country()+"/"+sensor.zone()},new String[]{"COUNTRY",sensor.country()})) {
            cassandra.execute(cassandra.prepare("INSERT INTO measurements_by_scope_month (scope_type,scope_key,bucket_month,measured_at,sensor_id,measurement_id,temperature,humidity) VALUES (?,?,?,?,?,?,?,?)")
                .bind(scope[0],scope[1].trim().toLowerCase(java.util.Locale.ROOT),bucket,input.measuredAt(),sensorId,id,input.temperature(),input.humidity()));
        }
        db.update("UPDATE sensors SET last_seen_at=GREATEST(COALESCE(last_seen_at, ?), ?) WHERE id=?",java.sql.Timestamp.from(input.measuredAt()),java.sql.Timestamp.from(input.measuredAt()),sensorId);
        if (input.measuredAt().isAfter(Instant.now().minusSeconds(3600))) alerts.resolveSensorAlerts(sensorId);
        if (outside(input.temperature(),sensor.minTemperature(),sensor.maxTemperature()) || outside(input.humidity(),sensor.minHumidity(),sensor.maxHumidity()))
            alerts.climateAlert(sensorId,id,"Measurement outside configured thresholds");
        return new Measurement(id,sensorId,input.measuredAt(),input.temperature(),input.humidity());
    }
    private boolean outside(BigDecimal value,BigDecimal low,BigDecimal high) { return value!=null && (low!=null && value.compareTo(low)<0 || high!=null && value.compareTo(high)>0); }
    List<Measurement> query(String scopeType,String scopeKey,Instant from,Instant to) {
        if (!List.of("CITY","ZONE","COUNTRY").contains(scopeType)) throw new IllegalArgumentException("scopeType must be CITY, ZONE or COUNTRY");
        if (scopeKey==null || scopeKey.isBlank() || from==null || to==null || !from.isBefore(to)) throw new IllegalArgumentException("Valid scopeKey, from and to are required");
        YearMonth first=YearMonth.from(from.atZone(ZoneOffset.UTC));
        YearMonth last=YearMonth.from(to.minusNanos(1).atZone(ZoneOffset.UTC));
        if (first.until(last,java.time.temporal.ChronoUnit.MONTHS)>23) throw new IllegalArgumentException("Query range may span at most 24 calendar months");
        List<Measurement> result=new ArrayList<>();
        for (YearMonth month=first; !month.isAfter(last); month=month.plusMonths(1)) {
            var stmt=cassandra.prepare("SELECT measured_at,sensor_id,measurement_id,temperature,humidity FROM measurements_by_scope_month WHERE scope_type=? AND scope_key=? AND bucket_month=? AND measured_at>=? AND measured_at<? LIMIT 10001");
            for (Row row:cassandra.execute(stmt.bind(scopeType,scopeKey.trim().toLowerCase(java.util.Locale.ROOT),month.toString(),from,to))) {
                result.add(new Measurement(row.getUuid("measurement_id"),row.getUuid("sensor_id"),row.getInstant("measured_at"),row.getBigDecimal("temperature"),row.getBigDecimal("humidity")));
                if (result.size()>10000) throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"Too many measurements; narrow the date range");
            }
        }
        result.sort((a,b)->b.measuredAt().compareTo(a.measuredAt()));
        return result;
    }
}
