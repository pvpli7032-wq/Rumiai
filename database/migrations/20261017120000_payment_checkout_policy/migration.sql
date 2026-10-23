CREATE TABLE "payment_checkout_policy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" DATETIME NOT NULL
);
