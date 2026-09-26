package com.poliglota.clima;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.core.Authentication;
import org.springframework.web.server.ResponseStatusException;

class UserControllerTest {
    private final JdbcTemplate db=mock(JdbcTemplate.class);
    private final UserController controller=new UserController(db);
    private final Authentication admin=mock(Authentication.class);

    @Test void changingRoleReplacesPreviousRoleAndClosesSessions() {
        UUID target=UUID.randomUUID();
        when(admin.getName()).thenReturn(UUID.randomUUID().toString());
        when(db.query(eq("SELECT role_name FROM user_roles WHERE user_id=? FOR UPDATE"),any(RowMapper.class),eq(target)))
            .thenReturn(List.of("USER"));

        controller.assign(target,new UserController.RoleInput("TECHNICIAN"),admin);

        verify(db).update("UPDATE user_roles SET role_name=? WHERE user_id=?","TECHNICIAN",target);
        verify(db).update("UPDATE sessions SET closed_at=now() WHERE user_id=? AND closed_at IS NULL",target);
    }

    @Test void administratorCannotChangeOwnRole() {
        UUID target=UUID.randomUUID();
        when(admin.getName()).thenReturn(target.toString());
        when(db.query(eq("SELECT role_name FROM user_roles WHERE user_id=? FOR UPDATE"),any(RowMapper.class),eq(target)))
            .thenReturn(List.of("ADMIN"));

        ResponseStatusException error=assertThrows(ResponseStatusException.class,
            ()->controller.assign(target,new UserController.RoleInput("USER"),admin));

        assertEquals(HttpStatus.CONFLICT,error.getStatusCode());
        verify(db,never()).update(anyString(),any(),any());
    }
}
