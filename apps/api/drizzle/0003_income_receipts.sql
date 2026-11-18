CREATE TABLE `income_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`received_date` text NOT NULL,
	`type` text NOT NULL,
	`source` text NOT NULL,
	`currency_code` text NOT NULL,
	`amount_hundredths` integer NOT NULL,
	`gross_hundredths` integer,
	`tds_hundredths` integer,
	`notes` text,
	`created_at` text NOT NULL,
	`retired_at` text,
	`archived_at` text,
	`replaces_receipt_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`,`replaces_receipt_id`) REFERENCES `income_receipts`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "income_receipts_date_check" CHECK(date("income_receipts"."received_date", '+0 days') is "income_receipts"."received_date"),
	CONSTRAINT "income_receipts_type_check" CHECK(trim("income_receipts"."type", char(9, 10, 11, 12, 13, 32)) <> ''),
	CONSTRAINT "income_receipts_source_check" CHECK(trim("income_receipts"."source", char(9, 10, 11, 12, 13, 32)) <> ''),
	CONSTRAINT "income_receipts_amount_check" CHECK(typeof("income_receipts"."amount_hundredths") = 'integer' and "income_receipts"."amount_hundredths" between 1 and 9007199254740991),
	CONSTRAINT "income_receipts_gross_check" CHECK("income_receipts"."gross_hundredths" is null or (
        typeof("income_receipts"."gross_hundredths") = 'integer' and
        "income_receipts"."gross_hundredths" between "income_receipts"."amount_hundredths" and 9007199254740991
      )),
	CONSTRAINT "income_receipts_tds_check" CHECK("income_receipts"."tds_hundredths" is null or (
        typeof("income_receipts"."tds_hundredths") = 'integer' and
        "income_receipts"."tds_hundredths" between 0 and 9007199254740991 and
        ("income_receipts"."gross_hundredths" is null or "income_receipts"."tds_hundredths" <= "income_receipts"."gross_hundredths" - "income_receipts"."amount_hundredths")
      )),
	CONSTRAINT "income_receipts_inactive_state_check" CHECK("income_receipts"."retired_at" is null or "income_receipts"."archived_at" is null),
	CONSTRAINT "income_receipts_no_self_replacement_check" CHECK("income_receipts"."replaces_receipt_id" <> "income_receipts"."id")
);
--> statement-breakpoint
CREATE INDEX `income_receipts_owner_date_idx` ON `income_receipts` (`user_id`,`received_date`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `income_receipts_owner_id_idx` ON `income_receipts` (`user_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `income_receipts_replacement_idx` ON `income_receipts` (`replaces_receipt_id`);