package com.poliglota.clima;

import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.Index;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;

@Configuration
class MonitoringConfig {
    private static final Logger log = LoggerFactory.getLogger(MonitoringConfig.class);
    private final JdbcTemplate db;
    private final AlertService alerts;
    MonitoringConfig(JdbcTemplate db,AlertService alerts) { this.db=db; this.alerts=alerts; }
    @Bean ApplicationRunner mongoIndexes(MongoTemplate mongo) {
        return args -> {
            mongo.indexOps("alerts").ensureIndex(new Index().on("status",Sort.Direction.ASC).on("createdAt",Sort.Direction.DESC));
            mongo.indexOps("alerts").ensureIndex(new Index().on("sensorId",Sort.Direction.ASC).on("type",Sort.Direction.ASC).on("status",Sort.Direction.ASC));
            mongo.indexOps("reports").ensureIndex(new Index().on("userId",Sort.Direction.ASC).on("createdAt",Sort.Direction.DESC));
            mongo.indexOps("messages").ensureIndex(new Index().on("type",Sort.Direction.ASC).on("senderId",Sort.Direction.ASC).on("recipientId",Sort.Direction.ASC).on("createdAt",Sort.Direction.DESC));
            mongo.indexOps("messages").ensureIndex(new Index().on("type",Sort.Direction.ASC).on("groupId",Sort.Direction.ASC).on("createdAt",Sort.Direction.DESC));
        };
    }
    @Scheduled(fixedDelay=300000)
    void staleSensors() {
        var ids=db.query("SELECT id FROM sensors WHERE status='ACTIVE' AND COALESCE(last_seen_at,started_at)<now()-interval '1 hour' LIMIT 500",
            (rs,n)->rs.getObject(1,UUID.class));
        for (UUID id:ids) {
            try { alerts.sensorAlert(id,"Sensor has not reported for over one hour"); }
            catch (RuntimeException ex) { log.error("Stale sensor alert failed sensorId={}",id,ex); }
        }
    }
}
