package com.poliglota.clima;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
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
@RequestMapping("/api/users")
class UserController {
    private static final Logger log = LoggerFactory.getLogger(UserController.class);
    private final JdbcTemplate db;
    UserController(JdbcTemplate db) { this.db=db; }
    record RoleInput(@NotBlank String role) {}
    @GetMapping("/me")
    Map<String,Object> me(Authentication auth) {
        return db.queryForMap("SELECT u.id,u.full_name,u.email,u.active,u.created_at,ur.role_name AS role FROM users u JOIN user_roles ur ON ur.user_id=u.id WHERE u.id=?",UUID.fromString(auth.getName()));
    }
    @GetMapping @PreAuthorize("hasRole('ADMIN')")
    List<Map<String,Object>> list() {
        return db.queryForList("SELECT u.id,u.full_name,u.email,u.active,u.created_at,ur.role_name AS role FROM users u JOIN user_roles ur ON ur.user_id=u.id ORDER BY u.created_at DESC LIMIT 500");
    }
    @GetMapping("/directory")
    List<Map<String,Object>> directory() {
        return db.queryForList("SELECT id,full_name,email FROM users WHERE active ORDER BY full_name LIMIT 500");
    }
    @PostMapping("/{id}/roles") @PreAuthorize("hasRole('ADMIN')") @Transactional
    void assign(@PathVariable UUID id,@Valid @RequestBody RoleInput in,Authentication auth) {
        if (!List.of("USER","TECHNICIAN","ADMIN").contains(in.role())) throw new IllegalArgumentException("Invalid role");
        String current=db.query("SELECT role_name FROM user_roles WHERE user_id=? FOR UPDATE",(rs,n)->rs.getString(1),id)
            .stream().findFirst().orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"User role not found"));
        if (current.equals(in.role())) return;
        if (id.toString().equals(auth.getName())) throw new ResponseStatusException(HttpStatus.CONFLICT,"Cannot change your own role");
        if (current.equals("ADMIN")) {
            Integer admins=db.queryForObject("SELECT count(*) FROM user_roles WHERE role_name='ADMIN'",Integer.class);
            if (admins!=null && admins<=1) throw new ResponseStatusException(HttpStatus.CONFLICT,"Cannot change the last administrator");
        }
        db.update("UPDATE user_roles SET role_name=? WHERE user_id=?",in.role(),id);
        db.update("UPDATE sessions SET closed_at=now() WHERE user_id=? AND closed_at IS NULL",id);
        log.info("Role changed actorId={} userId={} from={} to={}",auth.getName(),id,current,in.role());
    }
    @DeleteMapping("/{id}/roles/{role}") @PreAuthorize("hasRole('ADMIN')")
    void revoke() {
        throw new ResponseStatusException(HttpStatus.CONFLICT,"A user must have one role; assign another role instead");
    }
    @PatchMapping("/{id}/active") @PreAuthorize("hasRole('ADMIN')") @Transactional
    void active(@PathVariable UUID id,@RequestParam boolean value,Authentication auth) {
        if (id.toString().equals(auth.getName()) && !value) throw new IllegalArgumentException("Cannot deactivate your own account");
        if (db.update("UPDATE users SET active=? WHERE id=?",value,id)==0) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"User not found");
        if (!value) db.update("UPDATE sessions SET closed_at=now() WHERE user_id=? AND closed_at IS NULL",id);
        log.info("Account active changed actorId={} userId={} active={}",auth.getName(),id,value);
    }
}
