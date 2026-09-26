WITH ranked AS (
  SELECT user_id, role_name,
         row_number() OVER (
           PARTITION BY user_id
           ORDER BY CASE role_name WHEN 'ADMIN' THEN 3 WHEN 'TECHNICIAN' THEN 2 ELSE 1 END DESC
         ) AS position
  FROM user_roles
)
DELETE FROM user_roles ur USING ranked r
WHERE ur.user_id = r.user_id AND ur.role_name = r.role_name AND r.position > 1;

INSERT INTO user_roles(user_id, role_name)
SELECT u.id, 'USER' FROM users u
WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id);

UPDATE sessions s SET closed_at = now()
WHERE s.closed_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = s.user_id AND ur.role_name = s.role_name
  );

ALTER TABLE user_roles ADD CONSTRAINT user_roles_one_role_per_user UNIQUE (user_id);
