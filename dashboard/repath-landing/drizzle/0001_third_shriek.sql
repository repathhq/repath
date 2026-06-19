CREATE TABLE `decisions` (
	`id` varchar(64) NOT NULL,
	`rolloutId` varchar(64) NOT NULL,
	`action` enum('advance','rollback','promote','pause') NOT NULL,
	`reason` text,
	`previousWeight` int,
	`newWeight` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `decisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `metrics` (
	`id` varchar(64) NOT NULL,
	`rolloutId` varchar(64) NOT NULL,
	`role` enum('baseline','candidate') NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`avgQuality` int NOT NULL,
	`p95Latency` int NOT NULL,
	`errorRate` int NOT NULL,
	`requestCount` int NOT NULL,
	CONSTRAINT `metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rolloutSteps` (
	`id` varchar(64) NOT NULL,
	`rolloutId` varchar(64) NOT NULL,
	`stepNumber` int NOT NULL,
	`targetWeight` int NOT NULL,
	`gateExpression` text,
	`status` enum('pending','active','passed','failed') NOT NULL DEFAULT 'pending',
	`startedAt` timestamp,
	`completedAt` timestamp,
	CONSTRAINT `rolloutSteps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rollouts` (
	`id` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`state` enum('created','shadow','canary','promoted','rolled_back','paused') NOT NULL DEFAULT 'created',
	`baselineModel` varchar(255) NOT NULL,
	`candidateModel` varchar(255) NOT NULL,
	`baselineSystemPrompt` text,
	`candidateSystemPrompt` text,
	`currentWeight` int NOT NULL DEFAULT 0,
	`targetWeight` int NOT NULL DEFAULT 100,
	`rollbackThreshold` int NOT NULL DEFAULT 70,
	`advanceThreshold` int NOT NULL DEFAULT 90,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `rollouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `decisions` ADD CONSTRAINT `decisions_rolloutId_rollouts_id_fk` FOREIGN KEY (`rolloutId`) REFERENCES `rollouts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `metrics` ADD CONSTRAINT `metrics_rolloutId_rollouts_id_fk` FOREIGN KEY (`rolloutId`) REFERENCES `rollouts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `rolloutSteps` ADD CONSTRAINT `rolloutSteps_rolloutId_rollouts_id_fk` FOREIGN KEY (`rolloutId`) REFERENCES `rollouts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `rollouts` ADD CONSTRAINT `rollouts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;