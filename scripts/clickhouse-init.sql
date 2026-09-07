CREATE DATABASE IF NOT EXISTS cinepilot;
CREATE TABLE IF NOT EXISTS cinepilot.cinepilot_incidents (
  strategy String, incident_type String, incidents UInt32, days_saved Float64, success_rate Float64
) ENGINE = MergeTree ORDER BY (incident_type, strategy);
INSERT INTO cinepilot.cinepilot_incidents VALUES
('reorder','LOCATION_ACCESS_REVOKED',12,2.4,88),
('split_unit','LOCATION_ACCESS_REVOKED',9,2.7,81),
('relocate','LOCATION_ACCESS_REVOKED',7,1.8,73);
CREATE TABLE IF NOT EXISTS cinepilot.cinepilot_outcomes (
  run_id String, scenario_id String, strategy String, verified UInt8, status String, recorded_at DateTime
) ENGINE = MergeTree ORDER BY recorded_at;
