/*
  Warnings:

  - You are about to drop the `signIn` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "signIn";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "SignIn" (
    "email" TEXT NOT NULL PRIMARY KEY,
    "password" TEXT NOT NULL,
    "keepConnected" BOOLEAN NOT NULL,
    "token" TEXT NOT NULL
);
