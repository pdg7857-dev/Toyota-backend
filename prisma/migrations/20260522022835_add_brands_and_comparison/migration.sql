-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('REPORTED', 'RECALL_OPEN', 'RECALL_CLOSED', 'TSB', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MentionPlatform" AS ENUM ('REDDIT', 'FORUM', 'PROFESSIONAL_REVIEW', 'YOUTUBE', 'RECALL_DB', 'CONSUMER_REPORTS', 'OTHER');

-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED');

-- AlterTable
ALTER TABLE "models" ADD COLUMN     "brand_id" INTEGER,
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "starting_msrp_cad" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "brands" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "parent_company" TEXT,
    "website_url" TEXT,
    "logo_url" TEXT,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "basic_warranty_months" INTEGER,
    "basic_warranty_km" INTEGER,
    "powertrain_warranty_months" INTEGER,
    "powertrain_warranty_km" INTEGER,
    "hybrid_component_months" INTEGER,
    "hybrid_component_km" INTEGER,
    "hybrid_battery_months" INTEGER,
    "hybrid_battery_km" INTEGER,
    "corrosion_months" INTEGER,
    "corrosion_km" INTEGER,
    "roadside_months" INTEGER,
    "roadside_km" INTEGER,
    "reliability_score" DECIMAL(3,1),
    "resale_value_score" DECIMAL(3,1),
    "dealer_network_score" DECIMAL(3,1),
    "notes_md" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ownership_costs" (
    "id" SERIAL NOT NULL,
    "model_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "tire_front_size" TEXT,
    "tire_rear_size" TEXT,
    "est_tire_set_cad" DECIMAL(10,2),
    "est_winter_tire_set_cad" DECIMAL(10,2),
    "oil_type" TEXT,
    "oil_capacity_l" DECIMAL(4,1),
    "est_oil_change_cad" DECIMAL(10,2),
    "oil_change_interval_km" INTEGER,
    "brake_job_front_cad" DECIMAL(10,2),
    "brake_job_rear_cad" DECIMAL(10,2),
    "dealer_labour_rate_cad" DECIMAL(10,2),
    "indie_labour_rate_cad" DECIMAL(10,2),
    "included_maintenance_months" INTEGER,
    "included_maintenance_km" INTEGER,
    "included_maintenance_notes" TEXT,
    "five_year_ownership_cost_cad" DECIMAL(10,2),
    "source_urls" TEXT[],
    "notes_md" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ownership_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "common_issues" (
    "id" SERIAL NOT NULL,
    "model_id" INTEGER,
    "brand_id" INTEGER,
    "years_affected" INTEGER[],
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "IssueStatus" NOT NULL DEFAULT 'REPORTED',
    "mention_count" INTEGER NOT NULL DEFAULT 1,
    "recall_id" TEXT,
    "source_url" TEXT,
    "evidence_md" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "common_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pros_cons" (
    "id" SERIAL NOT NULL,
    "model_id" INTEGER,
    "brand_id" INTEGER,
    "is_pro" BOOLEAN NOT NULL,
    "text" TEXT NOT NULL,
    "source_url" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pros_cons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_mentions" (
    "id" SERIAL NOT NULL,
    "model_id" INTEGER,
    "brand_id" INTEGER,
    "platform" "MentionPlatform" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "author_handle" TEXT,
    "subreddit" TEXT,
    "summary" TEXT,
    "sentiment" "Sentiment",
    "upvotes" INTEGER,
    "posted_at" TIMESTAMP(3),
    "scraped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE INDEX "ownership_costs_model_id_idx" ON "ownership_costs"("model_id");

-- CreateIndex
CREATE UNIQUE INDEX "ownership_costs_model_id_year_key" ON "ownership_costs"("model_id", "year");

-- CreateIndex
CREATE INDEX "common_issues_model_id_idx" ON "common_issues"("model_id");

-- CreateIndex
CREATE INDEX "common_issues_brand_id_idx" ON "common_issues"("brand_id");

-- CreateIndex
CREATE INDEX "common_issues_severity_idx" ON "common_issues"("severity");

-- CreateIndex
CREATE INDEX "pros_cons_model_id_idx" ON "pros_cons"("model_id");

-- CreateIndex
CREATE INDEX "pros_cons_brand_id_idx" ON "pros_cons"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_mentions_url_key" ON "external_mentions"("url");

-- CreateIndex
CREATE INDEX "external_mentions_model_id_idx" ON "external_mentions"("model_id");

-- CreateIndex
CREATE INDEX "external_mentions_brand_id_idx" ON "external_mentions"("brand_id");

-- CreateIndex
CREATE INDEX "external_mentions_platform_idx" ON "external_mentions"("platform");

-- CreateIndex
CREATE INDEX "models_brand_id_idx" ON "models"("brand_id");

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_costs" ADD CONSTRAINT "ownership_costs_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "common_issues" ADD CONSTRAINT "common_issues_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "common_issues" ADD CONSTRAINT "common_issues_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pros_cons" ADD CONSTRAINT "pros_cons_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pros_cons" ADD CONSTRAINT "pros_cons_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_mentions" ADD CONSTRAINT "external_mentions_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_mentions" ADD CONSTRAINT "external_mentions_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
