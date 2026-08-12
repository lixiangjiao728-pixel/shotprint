CREATE TABLE IF NOT EXISTS `daily_usage` (
  `key` text PRIMARY KEY NOT NULL,
  `day` text NOT NULL,
  `count` integer DEFAULT 0 NOT NULL,
  `updated_at` text NOT NULL
);
