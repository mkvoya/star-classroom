CREATE TABLE `classroom_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`round` integer NOT NULL,
	`answers` text NOT NULL,
	`saved_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `classrooms` (
	`code` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
