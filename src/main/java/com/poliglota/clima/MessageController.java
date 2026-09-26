package com.poliglota.clima;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bson.Document;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/messages")
class MessageController {
    private final JdbcTemplate db;
    private final MongoTemplate mongo;
    MessageController(JdbcTemplate db,MongoTemplate mongo) { this.db=db; this.mongo=mongo; }
    record PrivateMessage(@NotNull UUID recipientId,@NotBlank @Size(max=5000) String content) {}
    record GroupMessage(@NotBlank @Size(max=5000) String content) {}
    record NewGroup(@NotBlank @Size(max=120) String name) {}
    @PostMapping("/private") @ResponseStatus(HttpStatus.CREATED)
    Map<String,Object> privateMessage(@Valid @RequestBody PrivateMessage in,Authentication auth) {
        Integer count=db.queryForObject("SELECT count(*) FROM users WHERE id=? AND active",Integer.class,in.recipientId());
        if (count==null || count==0) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Recipient not found");
        String id=UUID.randomUUID().toString();
        mongo.insert(new Document("_id",id).append("type","PRIVATE").append("senderId",auth.getName()).append("recipientId",in.recipientId().toString())
            .append("createdAt",java.util.Date.from(Instant.now())).append("content",in.content()),"messages");
        return Map.of("id",id);
    }
    @GetMapping("/private/{otherId}")
    List<Document> privateConversation(@PathVariable UUID otherId,Authentication auth) {
        Criteria c=new Criteria().orOperator(
            new Criteria().andOperator(Criteria.where("senderId").is(auth.getName()),Criteria.where("recipientId").is(otherId.toString())),
            new Criteria().andOperator(Criteria.where("senderId").is(otherId.toString()),Criteria.where("recipientId").is(auth.getName())));
        return mongo.find(new Query(Criteria.where("type").is("PRIVATE").andOperator(c)).with(Sort.by(Sort.Direction.DESC,"createdAt")).limit(200),Document.class,"messages");
    }
    @PostMapping("/groups") @ResponseStatus(HttpStatus.CREATED) @PreAuthorize("hasRole('ADMIN')")
    Map<String,Object> group(@Valid @RequestBody NewGroup in) {
        UUID id=UUID.randomUUID(); db.update("INSERT INTO message_groups(id,name) VALUES (?,?)",id,in.name()); return Map.of("id",id);
    }
    @PostMapping("/groups/{groupId}/members/{userId}") @PreAuthorize("hasRole('ADMIN')")
    void addMember(@PathVariable UUID groupId,@PathVariable UUID userId) { db.update("INSERT INTO group_members(group_id,user_id) VALUES (?,?) ON CONFLICT DO NOTHING",groupId,userId); }
    @GetMapping("/groups")
    List<Map<String,Object>> groups(Authentication auth) { return db.queryForList("SELECT g.id,g.name FROM message_groups g JOIN group_members gm ON gm.group_id=g.id WHERE gm.user_id=? ORDER BY g.name",UUID.fromString(auth.getName())); }
    @PostMapping("/groups/{id}") @ResponseStatus(HttpStatus.CREATED)
    Map<String,Object> groupMessage(@PathVariable UUID id,@Valid @RequestBody GroupMessage in,Authentication auth) {
        requireMember(id,auth);
        String messageId=UUID.randomUUID().toString();
        mongo.insert(new Document("_id",messageId).append("type","GROUP").append("groupId",id.toString()).append("senderId",auth.getName())
            .append("createdAt",java.util.Date.from(Instant.now())).append("content",in.content()),"messages");
        return Map.of("id",messageId);
    }
    @GetMapping("/groups/{id}")
    List<Document> groupConversation(@PathVariable UUID id,Authentication auth) {
        requireMember(id,auth);
        return mongo.find(Query.query(Criteria.where("type").is("GROUP").and("groupId").is(id.toString())).with(Sort.by(Sort.Direction.DESC,"createdAt")).limit(200),Document.class,"messages");
    }
    private void requireMember(UUID groupId,Authentication auth) {
        Integer count=db.queryForObject("SELECT count(*) FROM group_members WHERE group_id=? AND user_id=?",Integer.class,groupId,UUID.fromString(auth.getName()));
        if (count==null || count==0) throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Not a member of this group");
    }
}
