package com.poliglota.clima;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bson.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/processes")
class ProcessController {
    private static final Logger log = LoggerFactory.getLogger(ProcessController.class);
    private final JdbcTemplate db;
    private final ProcessService service;
    private final ObjectMapper json;
    private final SecurityRateLimiter limiter;
    ProcessController(JdbcTemplate db,ProcessService service,ObjectMapper json,SecurityRateLimiter limiter) { this.db=db; this.service=service; this.json=json; this.limiter=limiter; }
    record NewProcess(@NotBlank @Size(max=120) String name,@NotBlank @Size(max=2000) String description,@NotBlank String type,@NotNull @DecimalMin("0.00") BigDecimal price,@NotEmpty @Size(max=2) List<String> allowedRoles) {}
    @PostMapping @ResponseStatus(HttpStatus.CREATED) @PreAuthorize("hasRole('ADMIN')") @Transactional
    Map<String,Object> create(@Valid @RequestBody NewProcess in) {
        if (!List.of("MIN_MAX","AVERAGE","THRESHOLD","RAW","PERIODIC_AVERAGE").contains(in.type())) throw new IllegalArgumentException("Invalid process type");
        if (!List.of("USER","TECHNICIAN").containsAll(in.allowedRoles())) throw new IllegalArgumentException("Invalid allowed role");
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO processes(id,name,description,type,price) VALUES (?,?,?,?,?)",id,in.name(),in.description(),in.type(),in.price());
        for (String role:in.allowedRoles().stream().distinct().toList()) db.update("INSERT INTO process_roles(process_id,role_name) VALUES (?,?)",id,role);
        return Map.of("id",id);
    }
    @GetMapping List<Map<String,Object>> list(Authentication auth) {
        String role=auth.getAuthorities().iterator().next().getAuthority().substring(5);
        if (role.equals("ADMIN")) return db.queryForList("SELECT p.* FROM processes p WHERE p.active ORDER BY p.name");
        return db.queryForList("SELECT p.* FROM processes p JOIN process_roles pr ON pr.process_id=p.id WHERE p.active AND pr.role_name=? ORDER BY p.name",role);
    }
    @PostMapping("/{processId}/requests") @ResponseStatus(HttpStatus.CREATED)
    Map<String,Object> request(@PathVariable UUID processId,@Valid @RequestBody ProcessService.Parameters input,Authentication auth) {
        limiter.check("report-user",auth.getName(),30,Duration.ofHours(1));
        String role=auth.getAuthorities().iterator().next().getAuthority().substring(5);
        return Map.of("id",service.request(UUID.fromString(auth.getName()),role,processId,input));
    }
    @GetMapping("/requests")
    List<Map<String,Object>> requests(Authentication auth) {
        return normalizeParameters(db.queryForList("SELECT r.*,r.parameters::text AS parameters_json,p.name AS process_name,p.type AS process_type FROM process_requests r JOIN processes p ON p.id=r.process_id WHERE r.user_id=? ORDER BY r.requested_at DESC LIMIT 200",UUID.fromString(auth.getName())));
    }
    @GetMapping("/admin/requests") @PreAuthorize("hasAnyRole('TECHNICIAN','ADMIN')")
    List<Map<String,Object>> allRequests() {
        return normalizeParameters(db.queryForList("SELECT r.*,r.parameters::text AS parameters_json,p.name AS process_name,p.type AS process_type,u.full_name AS user_name,u.email AS user_email FROM process_requests r JOIN processes p ON p.id=r.process_id JOIN users u ON u.id=r.user_id ORDER BY r.requested_at DESC LIMIT 300"));
    }
    private List<Map<String,Object>> normalizeParameters(List<Map<String,Object>> rows) {
        for (var row:rows) {
            try { row.put("parameters",json.readValue((String)row.remove("parameters_json"),Map.class)); }
            catch (JsonProcessingException ex) { throw new IllegalStateException("Invalid stored process parameters",ex); }
        }
        return rows;
    }
    @GetMapping("/requests/{id}/executions")
    List<Map<String,Object>> executions(@PathVariable UUID id,Authentication auth) {
        boolean staff=auth.getAuthorities().stream().anyMatch(a->a.getAuthority().equals("ROLE_ADMIN")||a.getAuthority().equals("ROLE_TECHNICIAN"));
        if (staff) return db.queryForList("SELECT e.* FROM executions e WHERE e.request_id=? ORDER BY e.started_at DESC LIMIT 100",id);
        return db.queryForList("SELECT e.* FROM executions e JOIN process_requests r ON r.id=e.request_id WHERE r.id=? AND r.user_id=? ORDER BY e.started_at DESC LIMIT 100",id,UUID.fromString(auth.getName()));
    }
    @PostMapping("/requests/{id}/execute") @PreAuthorize("hasAnyRole('TECHNICIAN','ADMIN')")
    Map<String,Object> execute(@PathVariable UUID id,Authentication auth) {
        log.info("Report execution requested actorId={} requestId={}",auth.getName(),id);
        return Map.of("executionId",service.execute(id));
    }
    @PostMapping("/requests/{id}/retry") @PreAuthorize("hasAnyRole('TECHNICIAN','ADMIN')")
    void retry(@PathVariable UUID id,Authentication auth) {
        service.retry(id);
        log.info("Report retry requested actorId={} requestId={}",auth.getName(),id);
    }
    @GetMapping("/reports/{reportId}")
    Document report(@PathVariable String reportId,Authentication auth) { return service.report(reportId,UUID.fromString(auth.getName()),auth.getAuthorities().stream().anyMatch(a->a.getAuthority().equals("ROLE_ADMIN")||a.getAuthority().equals("ROLE_TECHNICIAN"))); }
}

@Service
class ProcessService {
    private static final Logger log = LoggerFactory.getLogger(ProcessService.class);
    private final JdbcTemplate db;
    private final MeasurementService readings;
    private final MongoTemplate mongo;
    private final BillingService billing;
    private final ObjectMapper json;
    ProcessService(JdbcTemplate db,MeasurementService readings,MongoTemplate mongo,BillingService billing,ObjectMapper json) {
        this.db=db; this.readings=readings; this.mongo=mongo; this.billing=billing; this.json=json;
    }
    record Parameters(@NotBlank String scopeType,@NotBlank @Size(max=400) String scopeKey,@NotNull Instant from,@NotNull Instant to,
        String granularity,BigDecimal minTemperature,BigDecimal maxTemperature,BigDecimal minHumidity,BigDecimal maxHumidity,
        @Min(1) @Max(8760) Integer repeatHours) {}
    UUID request(UUID userId,String role,UUID processId,Parameters p) {
        Integer adminRoles=db.queryForObject("SELECT count(*) FROM user_roles WHERE user_id=? AND role_name='ADMIN'",Integer.class,userId);
        if (adminRoles!=null && adminRoles>0) throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Administrators cannot request reports");
        String type=db.query("SELECT p.type FROM processes p JOIN process_roles pr ON pr.process_id=p.id WHERE p.id=? AND p.active AND pr.role_name=?",(rs,n)->rs.getString(1),processId,role).stream().findFirst()
            .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Process not found"));
        validate(type,p);
        UUID id=UUID.randomUUID();
        try {
            db.update("INSERT INTO process_requests(id,user_id,process_id,parameters,requested_at,status,repeat_hours,next_run_at) VALUES (?,?,?,?::jsonb,now(),'PENDING',?,?)",
                id,userId,processId,json.writeValueAsString(p),p.repeatHours(),p.repeatHours()==null?null:java.sql.Timestamp.from(Instant.now()));
        } catch (JsonProcessingException e) { throw new IllegalArgumentException("Invalid parameters",e); }
        log.info("Report requested requestId={} userId={} processId={}",id,userId,processId);
        return id;
    }
    private void validate(String type,Parameters p) {
        if (!List.of("CITY","ZONE","COUNTRY").contains(p.scopeType().toUpperCase())) throw new IllegalArgumentException("Invalid scope type");
        if (p.scopeKey().isBlank() || !p.from().isBefore(p.to())) throw new IllegalArgumentException("Invalid scope or date range");
        if (p.granularity()!=null && !List.of("DAY","MONTH","YEAR").contains(p.granularity().toUpperCase())) throw new IllegalArgumentException("Invalid granularity");
        if (type.equals("PERIODIC_AVERAGE") != (p.repeatHours()!=null)) throw new IllegalArgumentException("repeatHours is required only for PERIODIC_AVERAGE");
        if (type.equals("THRESHOLD") && p.minTemperature()==null && p.maxTemperature()==null && p.minHumidity()==null && p.maxHumidity()==null) throw new IllegalArgumentException("Threshold limits required");
    }
    private record RequestRow(UUID id,UUID userId,String type,String name,BigDecimal price,String parameters,Integer repeatHours) {}
    void retry(UUID id) {
        if (db.update("UPDATE process_requests SET status='PENDING',next_run_at=CASE WHEN repeat_hours IS NULL THEN NULL ELSE now() END WHERE id=? AND status='FAILED'",id)==0)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Request is not failed");
    }
    UUID execute(UUID id) {
        var rows=db.query("SELECT r.id,r.user_id,p.type,p.name,p.price,r.parameters::text,r.repeat_hours FROM process_requests r JOIN processes p ON p.id=r.process_id WHERE r.id=?",
            (rs,n)->new RequestRow(rs.getObject(1,UUID.class),rs.getObject(2,UUID.class),rs.getString(3),rs.getString(4),rs.getBigDecimal(5),rs.getString(6),(Integer)rs.getObject(7)),id);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Request not found");
        RequestRow row=rows.getFirst();
        int locked=db.update("UPDATE process_requests SET status='RUNNING' WHERE id=? AND (status='PENDING' OR (status='COMPLETED' AND repeat_hours IS NOT NULL AND next_run_at<=now()))",id);
        if (locked==0) throw new ResponseStatusException(HttpStatus.CONFLICT,"Request is not pending or due");
        UUID executionId=UUID.randomUUID();
        db.update("INSERT INTO executions(id,request_id,started_at,status) VALUES (?,?,now(),'RUNNING')",executionId,id);
        String reportId=UUID.randomUUID().toString();
        try {
            Parameters p=json.readValue(row.parameters(),Parameters.class);
            if (row.repeatHours()!=null) {
                Instant end=Instant.now();
                p=new Parameters(p.scopeType(),p.scopeKey(),end.minus(Duration.between(p.from(),p.to())),end,p.granularity(),
                    p.minTemperature(),p.maxTemperature(),p.minHumidity(),p.maxHumidity(),p.repeatHours());
            }
            Object result=calculate(row.type(),p);
            mongo.insert(new Document("_id",reportId).append("requestId",id.toString()).append("executionId",executionId.toString())
                .append("userId",row.userId().toString()).append("processType",row.type()).append("createdAt",java.util.Date.from(Instant.now()))
                .append("parameters",Document.parse(json.writeValueAsString(p)))
                .append("result",Document.parse(json.writeValueAsString(Map.of("value",result))).get("value")),"reports");
            billing.finishExecution(id,row.userId(),executionId,reportId,row.name(),row.price(),row.repeatHours());
            log.info("Report execution completed requestId={} executionId={}",id,executionId);
            return executionId;
        } catch (Exception ex) {
            log.error("Report execution failed requestId={} executionId={}",id,executionId,ex);
            try { mongo.remove(new org.springframework.data.mongodb.core.query.Query(org.springframework.data.mongodb.core.query.Criteria.where("_id").is(reportId)),"reports"); }
            catch (RuntimeException cleanupEx) { log.error("Report cleanup failed requestId={} reportId={}",id,reportId,cleanupEx); }
            db.update("UPDATE executions SET status='FAILED',finished_at=now(),error_text=? WHERE id=?","Execution failed",executionId);
            db.update("UPDATE process_requests SET status='FAILED' WHERE id=?",id);
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"Execution failed; see execution history");
        }
    }
    Object calculate(String type,Parameters p) {
        List<MeasurementService.Measurement> list=readings.query(p.scopeType().toUpperCase(),p.scopeKey(),p.from(),p.to());
        if (type.equals("RAW")) return list.stream().map(m->Map.of("id",m.id().toString(),"sensorId",m.sensorId().toString(),"measuredAt",m.measuredAt().toString(),"temperature",m.temperature()==null?"":m.temperature().toString(),"humidity",m.humidity()==null?"":m.humidity().toString())).toList();
        if (type.equals("THRESHOLD")) return list.stream().filter(m->outside(m.temperature(),p.minTemperature(),p.maxTemperature()) || outside(m.humidity(),p.minHumidity(),p.maxHumidity()))
            .map(m->Map.of("id",m.id().toString(),"sensorId",m.sensorId().toString(),"measuredAt",m.measuredAt().toString(),"temperature",m.temperature()==null?"":m.temperature().toString(),"humidity",m.humidity()==null?"":m.humidity().toString())).toList();
        String granularity=p.granularity()==null?"MONTH":p.granularity().toUpperCase();
        Map<String,List<MeasurementService.Measurement>> groups=new LinkedHashMap<>();
        for (var m:list) {
            var date=m.measuredAt().atZone(ZoneOffset.UTC).toLocalDate();
            String key=switch(granularity) { case "DAY" -> date.toString(); case "YEAR" -> Integer.toString(date.getYear()); default -> date.getYear()+"-"+String.format("%02d",date.getMonthValue()); };
            groups.computeIfAbsent(key,k->new ArrayList<>()).add(m);
        }
        List<Map<String,Object>> result=new ArrayList<>();
        for (var entry:groups.entrySet()) {
            Map<String,Object> item=new LinkedHashMap<>();
            item.put("period",entry.getKey()); item.put("count",entry.getValue().size());
            for (String metric:List.of("temperature","humidity")) {
                var values=entry.getValue().stream().map(m->metric.equals("temperature")?m.temperature():m.humidity()).filter(v->v!=null).toList();
                item.put(metric+"Count",values.size());
                if (!values.isEmpty()) {
                    if (type.equals("MIN_MAX")) {
                        item.put(metric+"Min",values.stream().min(BigDecimal::compareTo).orElseThrow());
                        item.put(metric+"Max",values.stream().max(BigDecimal::compareTo).orElseThrow());
                    } else item.put(metric+"Average",values.stream().reduce(BigDecimal.ZERO,BigDecimal::add).divide(BigDecimal.valueOf(values.size()),2,java.math.RoundingMode.HALF_UP));
                }
            }
            result.add(item);
        }
        return result;
    }
    private boolean outside(BigDecimal v,BigDecimal min,BigDecimal max) { return v!=null && (min!=null && v.compareTo(min)<0 || max!=null && v.compareTo(max)>0); }
    Document report(String id,UUID userId,boolean staff) {
        Document doc=mongo.findById(id,Document.class,"reports");
        if (doc==null) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Report not found");
        if (!staff && !userId.toString().equals(doc.getString("userId"))) throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Report belongs to another user");
        return doc;
    }
    @Scheduled(fixedDelay=60000)
    void runDue() {
        var due=db.query("SELECT id FROM process_requests WHERE next_run_at<=now() AND status IN ('PENDING','COMPLETED') ORDER BY next_run_at LIMIT 20",(rs,n)->rs.getObject(1,UUID.class));
        for (UUID id:due) try { execute(id); } catch (RuntimeException ex) { log.error("Scheduled report execution failed requestId={}",id,ex); }
        db.update("UPDATE invoices SET status='OVERDUE' WHERE status='PENDING' AND due_at<now()");
    }
}
