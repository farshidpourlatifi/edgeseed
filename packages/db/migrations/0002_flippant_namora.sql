CREATE TABLE `__new_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`inviterId` text NOT NULL,
	`expiresAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviterId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_invitation`("id", "organizationId", "email", "role", "status", "inviterId", "expiresAt", "createdAt") SELECT "id", "organizationId", "email", "role", "status", "inviterId", "expiresAt", "createdAt" FROM `invitation`;--> statement-breakpoint
DROP TABLE `invitation`;--> statement-breakpoint
ALTER TABLE `__new_invitation` RENAME TO `invitation`;--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organizationId`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE INDEX `invitation_inviterId_idx` ON `invitation` (`inviterId`);--> statement-breakpoint
CREATE TABLE `__new_member` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_member`("id", "organizationId", "userId", "role", "createdAt") SELECT "id", "organizationId", "userId", "role", "createdAt" FROM `member`;--> statement-breakpoint
DROP TABLE `member`;--> statement-breakpoint
ALTER TABLE `__new_member` RENAME TO `member`;--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`userId`);--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organizationId`);--> statement-breakpoint
CREATE INDEX `account_providerId_accountId_idx` ON `account` (`providerId`,`accountId`);--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE INDEX `apiToken_userId_idx` ON `apiToken` (`userId`);--> statement-breakpoint
CREATE INDEX `apiToken_organizationId_idx` ON `apiToken` (`organizationId`);--> statement-breakpoint
CREATE TABLE `__new_session` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`token` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`activeOrganizationId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activeOrganizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_session`("id", "userId", "token", "expiresAt", "ipAddress", "userAgent", "activeOrganizationId", "createdAt", "updatedAt") SELECT "id", "userId", "token", "expiresAt", "ipAddress", "userAgent", "activeOrganizationId", "createdAt", "updatedAt" FROM `session`;--> statement-breakpoint
DROP TABLE `session`;--> statement-breakpoint
ALTER TABLE `__new_session` RENAME TO `session`;--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);