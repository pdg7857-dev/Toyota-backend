-- AlterTable
ALTER TABLE "models" ADD COLUMN     "make" TEXT NOT NULL DEFAULT 'Toyota';

-- CreateIndex
CREATE INDEX "models_make_idx" ON "models"("make");
