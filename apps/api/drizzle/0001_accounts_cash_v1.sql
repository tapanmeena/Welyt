CREATE TABLE `account_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`observed_on` text NOT NULL,
	`balance_hundredths` integer NOT NULL,
	`source` text NOT NULL,
	`notes` text,
	`retired_at` text,
	`replaces_observation_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`,`replaces_observation_id`) REFERENCES `account_observations`(`account_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "account_observations_date_check" CHECK(date("account_observations"."observed_on", '+0 days') is "account_observations"."observed_on"),
	CONSTRAINT "account_observations_balance_check" CHECK(typeof("account_observations"."balance_hundredths") = 'integer' and "account_observations"."balance_hundredths" between -9007199254740991 and 9007199254740991),
	CONSTRAINT "account_observations_source_check" CHECK("account_observations"."source" = 'manual'),
	CONSTRAINT "account_observations_no_self_replacement_check" CHECK("account_observations"."replaces_observation_id" <> "account_observations"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_observations_current_date_idx` ON `account_observations` (`account_id`,`observed_on`) WHERE "account_observations"."retired_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `account_observations_account_id_id_idx` ON `account_observations` (`account_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_observations_replacement_idx` ON `account_observations` (`replaces_observation_id`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`currency_code` text DEFAULT 'INR' NOT NULL,
	`in_net_worth` integer DEFAULT true NOT NULL,
	`purpose` text,
	`notes` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "accounts_name_check" CHECK(trim("accounts"."name", char(9, 10, 11, 12, 13, 32)) <> ''),
	CONSTRAINT "accounts_kind_check" CHECK("accounts"."kind" in ('bank', 'cash', 'ewallet', 'brokerage_cash')),
	CONSTRAINT "accounts_in_net_worth_check" CHECK("accounts"."in_net_worth" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `accounts_owner_archive_idx` ON `accounts` (`user_id`,`archived_at`,`id`);--> statement-breakpoint
CREATE TABLE `currencies` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`minor_units` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "currencies_code_check" CHECK("currencies"."code" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "currencies_minor_units_check" CHECK(typeof("currencies"."minor_units") = 'integer' and "currencies"."minor_units" between 0 and 2)
);
--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`base_currency_code` text NOT NULL,
	`quote_currency_code` text NOT NULL,
	`rate_on` text NOT NULL,
	`rate_e8` integer NOT NULL,
	`source` text NOT NULL,
	`fetched_at` text,
	`user_id` text,
	`retired_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`base_currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`quote_currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "fx_rates_pair_check" CHECK("fx_rates"."quote_currency_code" = 'INR' and "fx_rates"."base_currency_code" <> "fx_rates"."quote_currency_code"),
	CONSTRAINT "fx_rates_date_check" CHECK(date("fx_rates"."rate_on", '+0 days') is "fx_rates"."rate_on"),
	CONSTRAINT "fx_rates_rate_check" CHECK(typeof("fx_rates"."rate_e8") = 'integer' and "fx_rates"."rate_e8" between 1 and 9007199254740991),
	CONSTRAINT "fx_rates_source_check" CHECK((
        ("fx_rates"."source" = 'manual' and "fx_rates"."user_id" is not null and "fx_rates"."fetched_at" is null)
        or ("fx_rates"."source" <> 'manual' and trim("fx_rates"."source") <> '' and "fx_rates"."user_id" is null and "fx_rates"."fetched_at" is not null)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_rates_current_provider_idx` ON `fx_rates` (`source`,`base_currency_code`,`quote_currency_code`,`rate_on`) WHERE "fx_rates"."user_id" is null and "fx_rates"."retired_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `fx_rates_current_manual_idx` ON `fx_rates` (`user_id`,`base_currency_code`,`quote_currency_code`,`rate_on`) WHERE "fx_rates"."user_id" is not null and "fx_rates"."retired_at" is null;
--> statement-breakpoint
INSERT INTO `currencies` (`code`, `name`, `minor_units`, `created_at`)
VALUES ('INR', 'Indian Rupee', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));