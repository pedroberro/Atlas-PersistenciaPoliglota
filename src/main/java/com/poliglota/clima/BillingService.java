package com.poliglota.clima;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@Service
class BillingService {
    private final JdbcTemplate db;
    BillingService(JdbcTemplate db) { this.db=db; }
    @Transactional
    void finishExecution(UUID requestId,UUID userId,UUID executionId,String reportId,String description,BigDecimal price,Integer repeatHours) {
        bill(userId,executionId,description,price);
        db.update("UPDATE executions SET status='COMPLETED',finished_at=now(),report_id=? WHERE id=?",reportId,executionId);
        db.update("UPDATE process_requests SET status='COMPLETED',next_run_at=? WHERE id=?",
            repeatHours==null?null:java.sql.Timestamp.from(Instant.now().plusSeconds(repeatHours*3600L)),requestId);
    }
    private void bill(UUID userId,UUID executionId,String description,BigDecimal price) {
        UUID invoiceId=UUID.randomUUID();
        Instant now=Instant.now();
        db.update("INSERT INTO invoices(id,user_id,issued_at,due_at,status,total) VALUES (?,?,?,?,?,?)",invoiceId,userId,java.sql.Timestamp.from(now),java.sql.Timestamp.from(now.plusSeconds(30L*86400)),price.signum()==0?"PAID":"PENDING",price);
        db.update("INSERT INTO invoice_items(id,invoice_id,execution_id,description,amount) VALUES (?,?,?,?,?)",UUID.randomUUID(),invoiceId,executionId,description,price);
        var accounts=db.query("SELECT id FROM current_accounts WHERE user_id=? FOR UPDATE",(rs,n)->rs.getObject(1,UUID.class),userId);
        if (!accounts.isEmpty() && price.signum()>0) {
            UUID accountId=accounts.getFirst();
            db.update("UPDATE current_accounts SET balance=balance+? WHERE id=?",price,accountId);
            db.update("INSERT INTO account_movements(id,account_id,occurred_at,kind,amount,invoice_id) VALUES (?,?,now(),'DEBIT',?,?)",UUID.randomUUID(),accountId,price,invoiceId);
        }
    }
    @Transactional
    UUID openAccount(UUID userId) {
        UUID id=UUID.randomUUID();
        int created=db.update("INSERT INTO current_accounts(id,user_id,balance) VALUES (?,?,0) ON CONFLICT(user_id) DO NOTHING",id,userId);
        UUID accountId=db.queryForObject("SELECT id FROM current_accounts WHERE user_id=?",UUID.class,userId);
        if (created==1) {
            var outstanding=db.query("SELECT i.id,i.total-COALESCE(sum(p.amount),0) AS remaining FROM invoices i LEFT JOIN payments p ON p.invoice_id=i.id WHERE i.user_id=? GROUP BY i.id,i.total HAVING i.total-COALESCE(sum(p.amount),0)>0",
                (rs,n)->Map.<String,Object>of("id",rs.getObject(1,UUID.class),"remaining",rs.getBigDecimal(2)),userId);
            for (var invoice:outstanding) {
                BigDecimal amount=(BigDecimal)invoice.get("remaining");
                db.update("UPDATE current_accounts SET balance=balance+? WHERE id=?",amount,accountId);
                db.update("INSERT INTO account_movements(id,account_id,occurred_at,kind,amount,invoice_id) VALUES (?,?,now(),'DEBIT',?,?)",UUID.randomUUID(),accountId,amount,invoice.get("id"));
            }
        }
        return accountId;
    }
    @Transactional
    UUID pay(UUID invoiceId,BigDecimal amount,String method,String reference) {
        var rows=db.query("SELECT user_id,total FROM invoices WHERE id=? FOR UPDATE",(rs,n)->Map.<String,Object>of("user",rs.getObject("user_id",UUID.class),"total",rs.getBigDecimal("total")),invoiceId);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Invoice not found");
        UUID userId=(UUID)rows.getFirst().get("user");
        BigDecimal total=(BigDecimal)rows.getFirst().get("total");
        BigDecimal already=db.queryForObject("SELECT COALESCE(sum(amount),0) FROM payments WHERE invoice_id=?",BigDecimal.class,invoiceId);
        if (amount.signum()<=0 || amount.compareTo(total.subtract(already))>0) throw new IllegalArgumentException("Payment exceeds outstanding amount or is not positive");
        UUID paymentId=UUID.randomUUID();
        db.update("INSERT INTO payments(id,invoice_id,paid_at,amount,method,reference) VALUES (?,?,now(),?,?,?)",paymentId,invoiceId,amount,method,reference);
        if (already.add(amount).compareTo(total)>=0) db.update("UPDATE invoices SET status='PAID' WHERE id=?",invoiceId);
        var accounts=db.query("SELECT id FROM current_accounts WHERE user_id=? FOR UPDATE",(rs,n)->rs.getObject(1,UUID.class),userId);
        if (!accounts.isEmpty()) {
            UUID accountId=accounts.getFirst();
            db.update("UPDATE current_accounts SET balance=balance-? WHERE id=?",amount,accountId);
            db.update("INSERT INTO account_movements(id,account_id,occurred_at,kind,amount,invoice_id,payment_id) VALUES (?,?,now(),'CREDIT',?,?,?)",UUID.randomUUID(),accountId,amount,invoiceId,paymentId);
        }
        return paymentId;
    }
}

@RestController
@RequestMapping("/api/billing")
class BillingController {
    private static final Logger log = LoggerFactory.getLogger(BillingController.class);
    private final JdbcTemplate db;
    private final BillingService service;
    BillingController(JdbcTemplate db,BillingService service) { this.db=db; this.service=service; }
    record PaymentInput(@NotNull @DecimalMin("0.01") BigDecimal amount,@NotBlank @Size(max=40) String method,@NotBlank @Size(max=120) String reference) {}
    @PostMapping("/account") @ResponseStatus(HttpStatus.CREATED)
    Map<String,Object> open(Authentication auth) { return Map.of("id",service.openAccount(UUID.fromString(auth.getName()))); }
    @GetMapping("/account")
    Map<String,Object> account(Authentication auth) {
        var rows=db.queryForList("SELECT id,balance FROM current_accounts WHERE user_id=?",UUID.fromString(auth.getName()));
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"No current account");
        return rows.getFirst();
    }
    @GetMapping("/account/movements")
    List<Map<String,Object>> movements(Authentication auth) {
        return db.queryForList("SELECT m.* FROM account_movements m JOIN current_accounts a ON a.id=m.account_id WHERE a.user_id=? ORDER BY m.occurred_at DESC LIMIT 200",UUID.fromString(auth.getName()));
    }
    @GetMapping("/invoices")
    List<Map<String,Object>> invoices(Authentication auth) {
        return db.queryForList("SELECT i.*,COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id=i.id),0) AS paid FROM invoices i WHERE user_id=? ORDER BY issued_at DESC LIMIT 200",UUID.fromString(auth.getName()));
    }
    @GetMapping("/admin/invoices") @org.springframework.security.access.prepost.PreAuthorize("hasRole('ADMIN')")
    List<Map<String,Object>> allInvoices() {
        return db.queryForList("SELECT i.*,u.full_name AS user_name,u.email AS user_email,COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id=i.id),0) AS paid FROM invoices i JOIN users u ON u.id=i.user_id ORDER BY i.issued_at DESC LIMIT 300");
    }
    @GetMapping("/invoices/{id}/items")
    List<Map<String,Object>> items(@PathVariable UUID id,Authentication auth) {
        if (auth.getAuthorities().stream().anyMatch(a->a.getAuthority().equals("ROLE_ADMIN")))
            return db.queryForList("SELECT * FROM invoice_items WHERE invoice_id=?",id);
        return db.queryForList("SELECT it.* FROM invoice_items it JOIN invoices i ON i.id=it.invoice_id WHERE i.id=? AND i.user_id=?",id,UUID.fromString(auth.getName()));
    }
    @PostMapping("/invoices/{id}/payments") @ResponseStatus(HttpStatus.CREATED) @org.springframework.security.access.prepost.PreAuthorize("hasRole('ADMIN')")
    Map<String,Object> pay(@PathVariable UUID id,@Valid @RequestBody PaymentInput in,Authentication auth) {
        UUID paymentId=service.pay(id,in.amount(),in.method(),in.reference());
        log.info("Payment recorded actorId={} invoiceId={} paymentId={}",auth.getName(),id,paymentId);
        return Map.of("id",paymentId);
    }
    @GetMapping("/invoices/{id}/payments")
    List<Map<String,Object>> payments(@PathVariable UUID id,Authentication auth) {
        if (auth.getAuthorities().stream().anyMatch(a->a.getAuthority().equals("ROLE_ADMIN")))
            return db.queryForList("SELECT * FROM payments WHERE invoice_id=? ORDER BY paid_at",id);
        return db.queryForList("SELECT p.* FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.id=? AND i.user_id=? ORDER BY p.paid_at",id,UUID.fromString(auth.getName()));
    }
}
