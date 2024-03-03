/*
  Warnings:

  - You are about to drop the column `keepConnected` on the `User` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "signIn" (
    "email" TEXT NOT NULL PRIMARY KEY,
    "password" TEXT NOT NULL,
    "keepConnected" BOOLEAN NOT NULL
);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "password" TEXT NOT NULL,
    "repeat_password" TEXT NOT NULL
);
INSERT INTO "new_User" ("email", "first_name", "id", "last_name", "password", "repeat_password") SELECT "email", "first_name", "id", "last_name", "password", "repeat_password" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
