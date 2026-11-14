CREATE TABLE IF NOT EXISTS invites (
  team TEXT NOT NULL,
  uid TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  PRIMARY KEY (team,uid),
  FOREIGN KEY (team,uid) REFERENCES members(team,uid)
);
