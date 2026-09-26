CREATE TABLE roles (name varchar(20) PRIMARY KEY);
INSERT INTO roles(name) VALUES ('USER'),('TECHNICIAN'),('ADMIN');
CREATE TABLE users (
  id uuid PRIMARY KEY, full_name varchar(200) NOT NULL, email varchar(320) NOT NULL UNIQUE,
  password_hash varchar(100) NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id), role_name varchar(20) NOT NULL REFERENCES roles(name),
  PRIMARY KEY (user_id,role_name)
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), role_name varchar(20) NOT NULL REFERENCES roles(name),
  started_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, closed_at timestamptz
);
CREATE INDEX sessions_user_open_idx ON sessions(user_id) WHERE closed_at IS NULL;
CREATE TABLE sensors (
  id uuid PRIMARY KEY, code varchar(80) NOT NULL UNIQUE, sensor_type varchar(20) NOT NULL CHECK (sensor_type IN ('TEMPERATURE','HUMIDITY','BOTH')),
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  city varchar(120) NOT NULL, zone varchar(120) NOT NULL, country varchar(120) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('ACTIVE','INACTIVE','FAULT')),
  started_at timestamptz NOT NULL, last_seen_at timestamptz,
  min_temperature numeric(7,2), max_temperature numeric(7,2), min_humidity numeric(5,2), max_humidity numeric(5,2),
  CHECK (min_temperature IS NULL OR max_temperature IS NULL OR min_temperature < max_temperature),
  CHECK (min_humidity IS NULL OR max_humidity IS NULL OR min_humidity < max_humidity)
);
CREATE INDEX sensors_location_idx ON sensors(country,zone,city);
CREATE TABLE sensor_credentials (
  sensor_id uuid PRIMARY KEY REFERENCES sensors(id), key_hash char(64) NOT NULL UNIQUE,
  rotated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sensor_controls (
  id uuid PRIMARY KEY, sensor_id uuid NOT NULL REFERENCES sensors(id), reviewed_at timestamptz NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('ACTIVE','INACTIVE','FAULT')), notes text,
  technician_id uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX sensor_controls_sensor_idx ON sensor_controls(sensor_id,reviewed_at DESC);
CREATE TABLE processes (
  id uuid PRIMARY KEY, name varchar(120) NOT NULL UNIQUE, description text NOT NULL,
  type varchar(30) NOT NULL CHECK (type IN ('MIN_MAX','AVERAGE','THRESHOLD','RAW','PERIODIC_AVERAGE')),
  price numeric(12,2) NOT NULL CHECK (price >= 0), active boolean NOT NULL DEFAULT true
);
CREATE TABLE process_roles (
  process_id uuid NOT NULL REFERENCES processes(id), role_name varchar(20) NOT NULL REFERENCES roles(name),
  PRIMARY KEY(process_id,role_name)
);
CREATE TABLE process_requests (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), process_id uuid NOT NULL REFERENCES processes(id),
  parameters jsonb NOT NULL, requested_at timestamptz NOT NULL, status varchar(20) NOT NULL CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED')),
  repeat_hours int CHECK (repeat_hours IS NULL OR repeat_hours BETWEEN 1 AND 8760), next_run_at timestamptz
);
CREATE INDEX process_requests_user_idx ON process_requests(user_id,requested_at DESC);
CREATE INDEX process_requests_due_idx ON process_requests(next_run_at) WHERE next_run_at IS NOT NULL;
CREATE TABLE executions (
  id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES process_requests(id), started_at timestamptz NOT NULL,
  finished_at timestamptz, status varchar(20) NOT NULL CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  report_id varchar(80), error_text text
);
CREATE INDEX executions_request_idx ON executions(request_id,started_at DESC);
CREATE TABLE invoices (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), issued_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL, status varchar(20) NOT NULL CHECK (status IN ('PENDING','PAID','OVERDUE')),
  total numeric(12,2) NOT NULL CHECK (total >= 0)
);
CREATE INDEX invoices_user_idx ON invoices(user_id,issued_at DESC);
CREATE TABLE invoice_items (
  id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoices(id), execution_id uuid NOT NULL UNIQUE REFERENCES executions(id),
  description varchar(200) NOT NULL, amount numeric(12,2) NOT NULL CHECK (amount >= 0)
);
CREATE TABLE payments (
  id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoices(id), paid_at timestamptz NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0), method varchar(40) NOT NULL, reference varchar(120) NOT NULL UNIQUE
);
CREATE TABLE current_accounts (
  id uuid PRIMARY KEY, user_id uuid NOT NULL UNIQUE REFERENCES users(id), balance numeric(12,2) NOT NULL DEFAULT 0
);
CREATE TABLE account_movements (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES current_accounts(id), occurred_at timestamptz NOT NULL,
  kind varchar(10) NOT NULL CHECK (kind IN ('DEBIT','CREDIT')), amount numeric(12,2) NOT NULL CHECK (amount > 0),
  invoice_id uuid REFERENCES invoices(id), payment_id uuid REFERENCES payments(id)
);
CREATE INDEX account_movements_account_idx ON account_movements(account_id,occurred_at DESC);
CREATE TABLE message_groups (id uuid PRIMARY KEY, name varchar(120) NOT NULL UNIQUE);
CREATE TABLE group_members (group_id uuid NOT NULL REFERENCES message_groups(id), user_id uuid NOT NULL REFERENCES users(id), PRIMARY KEY(group_id,user_id));
