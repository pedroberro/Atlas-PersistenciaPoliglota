package com.poliglota.clima;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bson.Document;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
class AlertService {
    private final MongoTemplate mongo;
    AlertService(MongoTemplate mongo) { this.mongo=mongo; }
    void sensorAlert(UUID sensorId,String description) {
        if (mongo.exists(Query.query(Criteria.where("sensorId").is(sensorId.toString()).and("type").is("SENSOR").and("status").is("ACTIVE")),"alerts")) return;
        create("SENSOR",sensorId,null,description);
    }
    void climateAlert(UUID sensorId,UUID measurementId,String description) { create("CLIMATE",sensorId,measurementId,description); }
    private void create(String type,UUID sensorId,UUID measurementId,String description) {
        Document doc=new Document("_id",UUID.randomUUID().toString()).append("type",type).append("sensorId",sensorId.toString())
            .append("measurementId",measurementId==null?null:measurementId.toString()).append("createdAt",java.util.Date.from(Instant.now()))
            .append("description",description).append("status","ACTIVE");
        mongo.insert(doc,"alerts");
    }
    void resolveSensorAlerts(UUID sensorId) {
        mongo.updateMulti(Query.query(Criteria.where("sensorId").is(sensorId.toString()).and("type").is("SENSOR").and("status").is("ACTIVE")),
            new Update().set("status","RESOLVED").set("resolvedAt",java.util.Date.from(Instant.now())),"alerts");
    }
    List<Document> list(String status) {
        Query q=new Query().with(Sort.by(Sort.Direction.DESC,"createdAt")).limit(200);
        if (status!=null) q.addCriteria(Criteria.where("status").is(status));
        return mongo.find(q,Document.class,"alerts");
    }
    void resolve(String id) {
        var result=mongo.updateFirst(Query.query(Criteria.where("_id").is(id)),new Update().set("status","RESOLVED").set("resolvedAt",java.util.Date.from(Instant.now())),"alerts");
        if (result.getMatchedCount()==0) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Alert not found");
    }
}
