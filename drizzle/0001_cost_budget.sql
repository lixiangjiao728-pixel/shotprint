CREATE TABLE IF NOT EXISTS `cost_budget` (
  `key` text PRIMARY KEY NOT NULL,
  `spent_micros` integer DEFAULT 0 NOT NULL,
  `reserved_micros` integer DEFAULT 0 NOT NULL,
  `limit_micros` integer NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cost_reservations` (
  `id` text PRIMARY KEY NOT NULL,
  `budget_key` text NOT NULL,
  `reserved_micros` integer NOT NULL,
  `actual_micros` integer,
  `settled` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
