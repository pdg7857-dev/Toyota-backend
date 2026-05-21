-- CreateEnum
CREATE TYPE "PowertrainType" AS ENUM ('GAS', 'HYBRID', 'PHEV', 'BEV');

-- CreateEnum
CREATE TYPE "WarrantyCoverageType" AS ENUM ('BASIC', 'POWERTRAIN', 'HYBRID_COMPONENT', 'HYBRID_BATTERY', 'CORROSION_PERFORATION', 'EMISSIONS', 'ACCESSORIES', 'ROADSIDE');

-- CreateEnum
CREATE TYPE "FinanceProductCategory" AS ENUM ('EXTENDED_WARRANTY', 'TIRE_RIM', 'APPEARANCE', 'PPF', 'GAP', 'KEY_REPLACEMENT', 'UNDERCOATING', 'OTHER');

-- CreateEnum
CREATE TYPE "RepNoteScope" AS ENUM ('MODEL', 'TRIM', 'GLOBAL', 'COMPETITOR');

-- CreateEnum
CREATE TYPE "ScrapeRunStatus" AS ENUM ('PENDING_REVIEW', 'APPLIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ScrapeDiffDecision" AS ENUM ('PENDING', 'ACCEPT', 'REJECT');

-- CreateTable
CREATE TABLE "models" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body_style" TEXT,
    "segment" TEXT,
    "notes_md" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "powertrains" (
    "id" SERIAL NOT NULL,
    "type" "PowertrainType" NOT NULL,
    "display_name" TEXT NOT NULL,
    "engine_desc" TEXT,
    "horsepower_hp" INTEGER,
    "torque_lbft" INTEGER,
    "transmission" TEXT,
    "drivetrain" TEXT,
    "battery_kwh" DECIMAL(5,2),
    "electric_range_km" INTEGER,
    "fuel_economy_city_l100" DECIMAL(4,1),
    "fuel_economy_hwy_l100" DECIMAL(4,1),
    "fuel_economy_comb_l100" DECIMAL(4,1),

    CONSTRAINT "powertrains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trims" (
    "id" SERIAL NOT NULL,
    "model_id" INTEGER NOT NULL,
    "powertrain_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "msrp_cad" DECIMAL(10,2) NOT NULL,
    "notes_md" TEXT,
    "previous_trim_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fees" (
    "id" SERIAL NOT NULL,
    "trim_id" INTEGER NOT NULL,
    "freight_pdi_cad" DECIMAL(10,2),
    "ac_excise_cad" DECIMAL(10,2),
    "omvic_fee_cad" DECIMAL(10,2),
    "tire_stewardship_cad" DECIMAL(10,2),
    "dealer_admin_cad" DECIMAL(10,2),
    "other_fees_json" JSONB,
    "hst_rate" DECIMAL(4,3) NOT NULL DEFAULT 0.13,
    "effective_date" DATE NOT NULL,

    CONSTRAINT "fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_coverages" (
    "id" SERIAL NOT NULL,
    "model_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "coverage_type" "WarrantyCoverageType" NOT NULL,
    "duration_months" INTEGER,
    "distance_km" INTEGER,
    "applies_to_powertrains" "PowertrainType"[],
    "description_md" TEXT,
    "source_url" TEXT,

    CONSTRAINT "warranty_coverages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_products" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "FinanceProductCategory" NOT NULL,
    "description_md" TEXT,
    "pricing_notes" TEXT,
    "term_options_json" JSONB,
    "eligible_powertrains" "PowertrainType"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rep_notes" (
    "id" SERIAL NOT NULL,
    "scope_type" "RepNoteScope" NOT NULL,
    "scope_id" INTEGER,
    "title" TEXT NOT NULL,
    "body_md" TEXT NOT NULL,
    "tags" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rep_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrape_runs" (
    "id" SERIAL NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "status" "ScrapeRunStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "summary_json" JSONB,

    CONSTRAINT "scrape_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrape_diffs" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "table_name" TEXT NOT NULL,
    "record_pk" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "decision" "ScrapeDiffDecision" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "scrape_diffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "catalog_version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "models_slug_key" ON "models"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "trims_slug_key" ON "trims"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "trims_previous_trim_id_key" ON "trims"("previous_trim_id");

-- CreateIndex
CREATE INDEX "trims_year_idx" ON "trims"("year");

-- CreateIndex
CREATE INDEX "trims_model_id_year_idx" ON "trims"("model_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "trims_model_id_year_name_powertrain_id_key" ON "trims"("model_id", "year", "name", "powertrain_id");

-- CreateIndex
CREATE UNIQUE INDEX "fees_trim_id_effective_date_key" ON "fees"("trim_id", "effective_date");

-- CreateIndex
CREATE INDEX "warranty_coverages_model_id_year_idx" ON "warranty_coverages"("model_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "warranty_coverages_model_id_year_coverage_type_key" ON "warranty_coverages"("model_id", "year", "coverage_type");

-- CreateIndex
CREATE UNIQUE INDEX "finance_products_slug_key" ON "finance_products"("slug");

-- CreateIndex
CREATE INDEX "rep_notes_scope_type_scope_id_idx" ON "rep_notes"("scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "scrape_diffs_run_id_idx" ON "scrape_diffs"("run_id");

-- AddForeignKey
ALTER TABLE "trims" ADD CONSTRAINT "trims_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trims" ADD CONSTRAINT "trims_powertrain_id_fkey" FOREIGN KEY ("powertrain_id") REFERENCES "powertrains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trims" ADD CONSTRAINT "trims_previous_trim_id_fkey" FOREIGN KEY ("previous_trim_id") REFERENCES "trims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fees" ADD CONSTRAINT "fees_trim_id_fkey" FOREIGN KEY ("trim_id") REFERENCES "trims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_coverages" ADD CONSTRAINT "warranty_coverages_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrape_diffs" ADD CONSTRAINT "scrape_diffs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "scrape_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
