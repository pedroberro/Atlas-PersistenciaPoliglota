package com.poliglota.clima;

import java.util.List;
import org.bson.Document;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/alerts")
@PreAuthorize("hasAnyRole('TECHNICIAN','ADMIN')")
class AlertController {
    private final AlertService alerts;
    AlertController(AlertService alerts) { this.alerts=alerts; }
    @GetMapping List<Document> list(@RequestParam(required=false) String status) { return alerts.list(status); }
    @PostMapping("/{id}/resolve") void resolve(@PathVariable String id) { alerts.resolve(id); }
}
