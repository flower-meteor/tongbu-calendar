CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL);
--> statement-breakpoint
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
--> statement-breakpoint
    CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, invite TEXT NOT NULL UNIQUE, owner TEXT NOT NULL REFERENCES users(id));
--> statement-breakpoint
    CREATE TABLE IF NOT EXISTS members (team TEXT NOT NULL REFERENCES teams(id), uid TEXT NOT NULL REFERENCES users(id), PRIMARY KEY (team,uid));
--> statement-breakpoint
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, team TEXT NOT NULL REFERENCES teams(id), uid TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, kind TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, busy INTEGER NOT NULL, weekly INTEGER NOT NULL);
--> statement-breakpoint
    CREATE INDEX IF NOT EXISTS events_team_time ON events(team,start,end);
