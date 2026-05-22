-- CreateEnum
CREATE TYPE "BodyColorType" AS ENUM ('STANDARD', 'METALLIC', 'PEARL', 'TWO_TONE');

-- CreateEnum
CREATE TYPE "ConversationRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "body_colors" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT,
    "type" "BodyColorType" NOT NULL DEFAULT 'STANDARD',
    "notes_md" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "body_colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trim_colors" (
    "id" SERIAL NOT NULL,
    "trim_id" INTEGER NOT NULL,
    "body_color_id" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "premium_charge_cad" DECIMAL(10,2),
    "notes_md" TEXT,

    CONSTRAINT "trim_colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "role" "ConversationRole" NOT NULL,
    "content" TEXT NOT NULL,
    "model_used" TEXT,
    "citations_json" JSONB,
    "cached_input_tokens" INTEGER,
    "uncached_input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "body_colors_slug_key" ON "body_colors"("slug");

-- CreateIndex
CREATE INDEX "trim_colors_trim_id_idx" ON "trim_colors"("trim_id");

-- CreateIndex
CREATE INDEX "trim_colors_body_color_id_idx" ON "trim_colors"("body_color_id");

-- CreateIndex
CREATE UNIQUE INDEX "trim_colors_trim_id_body_color_id_key" ON "trim_colors"("trim_id", "body_color_id");

-- CreateIndex
CREATE INDEX "conversation_messages_conversation_id_idx" ON "conversation_messages"("conversation_id");

-- AddForeignKey
ALTER TABLE "trim_colors" ADD CONSTRAINT "trim_colors_trim_id_fkey" FOREIGN KEY ("trim_id") REFERENCES "trims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trim_colors" ADD CONSTRAINT "trim_colors_body_color_id_fkey" FOREIGN KEY ("body_color_id") REFERENCES "body_colors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
