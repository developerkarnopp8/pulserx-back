-- AlterTable
ALTER TABLE "training_plans" ADD COLUMN     "importedByAi" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastLoginAt" TIMESTAMP(3);
