-- CreateEnum
CREATE TYPE "FinancePromoKind" AS ENUM ('FINANCE', 'LEASE');

-- CreateEnum
CREATE TYPE "IncentiveKind" AS ENUM ('LOYALTY', 'CONQUEST', 'CASH_REBATE', 'FINANCE_RATE', 'LEASE_RATE', 'STUDENT_GRAD', 'MILITARY', 'FIRST_RESPONDER', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('LEAD', 'TEST_DRIVE_BOOKED', 'QUOTED', 'NEGOTIATING', 'SOLD', 'LOST', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "CustomerInteractionKind" AS ENUM ('CALL', 'EMAIL', 'TEXT', 'IN_PERSON', 'TEST_DRIVE', 'QUOTE_SENT', 'NOTE');

-- AlterTable
ALTER TABLE "trims" ADD COLUMN     "gvwr_lbs" INTEGER,
ADD COLUMN     "payload_lbs" INTEGER,
ADD COLUMN     "tow_rating_lbs" INTEGER;

-- CreateTable
CREATE TABLE "option_packages" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description_md" TEXT,
    "features_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "option_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trim_options" (
    "id" SERIAL NOT NULL,
    "trim_id" INTEGER NOT NULL,
    "option_package_id" INTEGER NOT NULL,
    "price_cad" DECIMAL(10,2),
    "available" BOOLEAN NOT NULL DEFAULT true,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "notes_md" TEXT,

    CONSTRAINT "trim_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_promos" (
    "id" SERIAL NOT NULL,
    "trim_id" INTEGER,
    "model_slug" TEXT,
    "kind" "FinancePromoKind" NOT NULL,
    "term_months" INTEGER NOT NULL,
    "apr_percent" DECIMAL(5,3),
    "money_factor" DECIMAL(7,5),
    "residual_percent" DECIMAL(5,2),
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "notes_md" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_promos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentives" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "IncentiveKind" NOT NULL,
    "amount_cad" DECIMAL(10,2),
    "stackable" BOOLEAN NOT NULL DEFAULT true,
    "eligible_makes" TEXT[],
    "eligible_slugs" TEXT[],
    "eligible_years" INTEGER[],
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "notes_md" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incentives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_intervals" (
    "id" SERIAL NOT NULL,
    "model_slug" TEXT,
    "powertrain_type" TEXT,
    "interval_km" INTEGER NOT NULL,
    "services_json" JSONB NOT NULL,
    "parts_cost_cad" DECIMAL(10,2),
    "labour_minutes" INTEGER,
    "notes_md" TEXT,

    CONSTRAINT "maintenance_intervals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'LEAD',
    "vehicle_of_interest_trim_id" INTEGER,
    "follow_up_date" DATE,
    "budget_cad" DECIMAL(10,2),
    "notes_md" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_interactions" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "kind" "CustomerInteractionKind" NOT NULL,
    "body_md" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "option_packages_slug_key" ON "option_packages"("slug");

-- CreateIndex
CREATE INDEX "trim_options_trim_id_idx" ON "trim_options"("trim_id");

-- CreateIndex
CREATE INDEX "trim_options_option_package_id_idx" ON "trim_options"("option_package_id");

-- CreateIndex
CREATE UNIQUE INDEX "trim_options_trim_id_option_package_id_key" ON "trim_options"("trim_id", "option_package_id");

-- CreateIndex
CREATE INDEX "finance_promos_trim_id_idx" ON "finance_promos"("trim_id");

-- CreateIndex
CREATE INDEX "finance_promos_model_slug_idx" ON "finance_promos"("model_slug");

-- CreateIndex
CREATE INDEX "finance_promos_effective_from_effective_to_idx" ON "finance_promos"("effective_from", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "incentives_slug_key" ON "incentives"("slug");

-- CreateIndex
CREATE INDEX "incentives_effective_from_effective_to_idx" ON "incentives"("effective_from", "effective_to");

-- CreateIndex
CREATE INDEX "incentives_active_idx" ON "incentives"("active");

-- CreateIndex
CREATE INDEX "maintenance_intervals_model_slug_interval_km_idx" ON "maintenance_intervals"("model_slug", "interval_km");

-- CreateIndex
CREATE INDEX "customers_status_idx" ON "customers"("status");

-- CreateIndex
CREATE INDEX "customers_follow_up_date_idx" ON "customers"("follow_up_date");

-- CreateIndex
CREATE INDEX "customer_interactions_customer_id_idx" ON "customer_interactions"("customer_id");

-- AddForeignKey
ALTER TABLE "trim_options" ADD CONSTRAINT "trim_options_trim_id_fkey" FOREIGN KEY ("trim_id") REFERENCES "trims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trim_options" ADD CONSTRAINT "trim_options_option_package_id_fkey" FOREIGN KEY ("option_package_id") REFERENCES "option_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_promos" ADD CONSTRAINT "finance_promos_trim_id_fkey" FOREIGN KEY ("trim_id") REFERENCES "trims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_vehicle_of_interest_trim_id_fkey" FOREIGN KEY ("vehicle_of_interest_trim_id") REFERENCES "trims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_interactions" ADD CONSTRAINT "customer_interactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
