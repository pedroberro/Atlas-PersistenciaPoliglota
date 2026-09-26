package com.poliglota.clima;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

class ProcessServiceTest {
    private final MeasurementService readings=mock(MeasurementService.class);
    private final ProcessService service=new ProcessService(null,readings,null,null,null);
    private final Instant from=Instant.parse("2026-01-01T00:00:00Z");
    private final Instant to=Instant.parse("2026-03-01T00:00:00Z");
    private final String scope="Argentina/Buenos Aires/Buenos Aires";

    @Test void monthlyAveragesIgnoreMissingValuesAndSeparateMonths() {
        when(readings.query("CITY",scope,from,to)).thenReturn(List.of(
            m("2026-01-02T00:00:00Z","10",null),m("2026-01-03T00:00:00Z","20","40"),m("2026-02-02T00:00:00Z","30","60")));
        var p=new ProcessService.Parameters("CITY",scope,from,to,"MONTH",null,null,null,null,null);
        @SuppressWarnings("unchecked") var result=(List<Map<String,Object>>)service.calculate("AVERAGE",p);
        assertEquals(2,result.size());
        assertEquals("2026-01",result.get(0).get("period"));
        assertEquals(new BigDecimal("15.00"),result.get(0).get("temperatureAverage"));
        assertEquals(new BigDecimal("40.00"),result.get(0).get("humidityAverage"));
        assertEquals(1,result.get(0).get("humidityCount"));
    }

    @Test void thresholdIncludesOnlyOutOfRangeMeasurements() {
        when(readings.query("CITY",scope,from,to)).thenReturn(List.of(
            m("2026-01-02T00:00:00Z","10","40"),m("2026-01-03T00:00:00Z","30","90")));
        var p=new ProcessService.Parameters("CITY",scope,from,to,null,new BigDecimal("0"),new BigDecimal("25"),null,new BigDecimal("80"),null);
        @SuppressWarnings("unchecked") var result=(List<Map<String,Object>>)service.calculate("THRESHOLD",p);
        assertEquals(1,result.size());
        assertEquals("30",result.getFirst().get("temperature"));
    }

    @Test void administratorCannotRequestEvenWithUserSession() {
        JdbcTemplate db=mock(JdbcTemplate.class);
        UUID userId=UUID.randomUUID();
        when(db.queryForObject("SELECT count(*) FROM user_roles WHERE user_id=? AND role_name='ADMIN'",Integer.class,userId)).thenReturn(1);
        ProcessService secured=new ProcessService(db,readings,null,null,null);

        ResponseStatusException error=assertThrows(ResponseStatusException.class,
            ()->secured.request(userId,"USER",UUID.randomUUID(),null));

        assertEquals(HttpStatus.FORBIDDEN,error.getStatusCode());
        verify(db).queryForObject("SELECT count(*) FROM user_roles WHERE user_id=? AND role_name='ADMIN'",Integer.class,userId);
        verifyNoMoreInteractions(db);
    }
    private MeasurementService.Measurement m(String time,String temperature,String humidity) {
        return new MeasurementService.Measurement(UUID.randomUUID(),UUID.randomUUID(),Instant.parse(time),
            temperature==null?null:new BigDecimal(temperature),humidity==null?null:new BigDecimal(humidity));
    }
}
