CREATE KEYSPACE IF NOT EXISTS clima WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
CREATE TABLE IF NOT EXISTS clima.measurements_by_scope_month (
  scope_type text, scope_key text, bucket_month text, measured_at timestamp,
  sensor_id uuid, measurement_id uuid, temperature decimal, humidity decimal,
  PRIMARY KEY ((scope_type, scope_key, bucket_month), measured_at, sensor_id, measurement_id)
) WITH CLUSTERING ORDER BY (measured_at DESC, sensor_id ASC, measurement_id ASC);
