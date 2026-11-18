CREATE TABLE `monthly_plan_auto_copy_rules` (
	`user_id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`first_target_month` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "monthly_plan_auto_copy_rules_state_check" CHECK((
      ("monthly_plan_auto_copy_rules"."enabled" = 0 and "monthly_plan_auto_copy_rules"."first_target_month" is null) or
      ("monthly_plan_auto_copy_rules"."enabled" = 1 and "monthly_plan_auto_copy_rules"."first_target_month" is not null and "monthly_plan_auto_copy_rules"."first_target_month" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]' and substr("monthly_plan_auto_copy_rules"."first_target_month", 1, 4) <> '0000' and substr("monthly_plan_auto_copy_rules"."first_target_month", 6, 2) between '01' and '12')
    ))
);
--> statement-breakpoint
CREATE TABLE `monthly_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`month` text NOT NULL,
	`currency_code` text DEFAULT 'INR' NOT NULL,
	`revision` integer NOT NULL,
	`forecast_hundredths` integer NOT NULL,
	`created_at` text NOT NULL,
	`created_via` text NOT NULL,
	`copied_from_plan_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`,`copied_from_plan_id`) REFERENCES `monthly_plans`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "monthly_plans_month_check" CHECK("monthly_plans"."month" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]' and substr("monthly_plans"."month", 1, 4) <> '0000' and substr("monthly_plans"."month", 6, 2) between '01' and '12'),
	CONSTRAINT "monthly_plans_currency_check" CHECK("monthly_plans"."currency_code" = 'INR'),
	CONSTRAINT "monthly_plans_revision_check" CHECK(typeof("monthly_plans"."revision") = 'integer' and "monthly_plans"."revision" between 1 and 9007199254740991),
	CONSTRAINT "monthly_plans_forecast_check" CHECK(typeof("monthly_plans"."forecast_hundredths") = 'integer' and "monthly_plans"."forecast_hundredths" between 0 and 9007199254740991),
	CONSTRAINT "monthly_plans_copy_check" CHECK((
      ("monthly_plans"."created_via" = 'manual' and "monthly_plans"."copied_from_plan_id" is null) or
      ("monthly_plans"."created_via" in ('manual_copy', 'auto_copy') and "monthly_plans"."revision" = 1 and
       "monthly_plans"."copied_from_plan_id" is not null and "monthly_plans"."copied_from_plan_id" <> "monthly_plans"."id")
    ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_plans_owner_month_revision_idx` ON `monthly_plans` (`user_id`,`month`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_plans_owner_id_idx` ON `monthly_plans` (`user_id`,`id`);--> statement-breakpoint
CREATE TABLE `plan_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`monthly_plan_id` text NOT NULL,
	`name` text NOT NULL,
	`allocation_group` text NOT NULL,
	`amount_hundredths` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`monthly_plan_id`) REFERENCES `monthly_plans`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "plan_allocations_name_check" CHECK(trim("plan_allocations"."name", char(9, 10, 11, 12, 13, 32)) <> ''),
	CONSTRAINT "plan_allocations_group_check" CHECK("plan_allocations"."allocation_group" in ('fixed', 'flexible', 'saving')),
	CONSTRAINT "plan_allocations_amount_check" CHECK(typeof("plan_allocations"."amount_hundredths") = 'integer' and "plan_allocations"."amount_hundredths" between 1 and 9007199254740991),
	CONSTRAINT "plan_allocations_position_check" CHECK(typeof("plan_allocations"."position") = 'integer' and "plan_allocations"."position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_allocations_plan_position_idx` ON `plan_allocations` (`monthly_plan_id`,`position`);