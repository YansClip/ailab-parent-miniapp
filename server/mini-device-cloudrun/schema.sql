-- Run ONLY in a separately approved private test database, via an admin tool.
-- No automatic creation/import at server startup. Runtime account: CRUD only.
CREATE TABLE IF NOT EXISTS mini_gateway_records (
  collection_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  record_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  data JSON NOT NULL,
  PRIMARY KEY (collection_name, record_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS mini_gateway_mutex (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY
) ENGINE=InnoDB;
INSERT IGNORE INTO mini_gateway_mutex (id) VALUES (1);
