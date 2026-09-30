-- AlterEnum
ALTER TYPE "SkipReason" ADD VALUE 'Withheld';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "healthConsent" BOOLEAN,
ADD COLUMN     "healthConsentAt" TIMESTAMP(3),
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsVersion" TEXT;

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "asaasCustomerId" TEXT,
ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "unlinkedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "exercise_library" ADD COLUMN     "autoImported" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "movements" ADD COLUMN     "athleteId" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "platformFeePercent" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "gateway_payments" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "asaasPaymentId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "amount" DOUBLE PRECISION NOT NULL,
    "netValue" DOUBLE PRECISION,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "invoiceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_logs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'ASAAS',
    "event" TEXT NOT NULL,
    "asaasPaymentId" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_profiles" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "bio" TEXT,
    "bannerUrl" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "photoUrl" TEXT,
    "headline" TEXT,
    "subheadline" TEXT,
    "quote" TEXT,
    "achievementBadge" TEXT,
    "yearsExperience" INTEGER,
    "athletesCount" INTEGER,
    "npsScore" INTEGER,
    "completionRate" DOUBLE PRECISION,
    "whatsappNumber" TEXT,
    "videoUrl" TEXT,
    "guaranteeDays" INTEGER,
    "guaranteeText" TEXT,
    "supportEmail" TEXT,
    "supportHours" TEXT,
    "pageCopy" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coach_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonials" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT,
    "rating" INTEGER NOT NULL DEFAULT 5,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faq_items" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gateway_payments_asaasPaymentId_key" ON "gateway_payments"("asaasPaymentId");

-- CreateIndex
CREATE INDEX "gateway_payments_subscriptionId_idx" ON "gateway_payments"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "coach_profiles_coachId_key" ON "coach_profiles"("coachId");

-- CreateIndex
CREATE UNIQUE INDEX "coach_profiles_slug_key" ON "coach_profiles"("slug");

-- CreateIndex
CREATE INDEX "testimonials_coachId_idx" ON "testimonials"("coachId");

-- CreateIndex
CREATE INDEX "faq_items_coachId_idx" ON "faq_items"("coachId");

-- CreateIndex
CREATE INDEX "leads_coachId_idx" ON "leads"("coachId");

-- CreateIndex
CREATE UNIQUE INDEX "students_cpf_key" ON "students"("cpf");

-- CreateIndex
CREATE INDEX "exercise_library_coachId_idx" ON "exercise_library"("coachId");

-- CreateIndex
CREATE INDEX "movements_athleteId_idx" ON "movements"("athleteId");

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_payments" ADD CONSTRAINT "gateway_payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_profiles" ADD CONSTRAINT "coach_profiles_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faq_items" ADD CONSTRAINT "faq_items_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

