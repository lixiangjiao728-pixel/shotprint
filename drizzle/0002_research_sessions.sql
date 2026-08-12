CREATE TABLE `research_sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_research_sessions_expires_at` ON `research_sessions` (`expires_at`);
