CREATE TABLE "gift_catalog_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "emoji" TEXT NOT NULL DEFAULT '🎁',
  "coin_price" INTEGER NOT NULL CHECK ("coin_price" BETWEEN 1 AND 1000000),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "gift_catalog_items_is_active_sort_order_idx" ON "gift_catalog_items"("is_active","sort_order");

INSERT INTO "gift_catalog_items" ("id","code","name","description","emoji","coin_price","is_active","sort_order")
VALUES ('gift_default_rose','rose','玫瑰','送给喜欢的角色一朵玫瑰。','🌹',10,true,0);

ALTER TABLE "gifts" ADD COLUMN "catalog_id" TEXT REFERENCES "gift_catalog_items"("id") ON DELETE SET NULL;
UPDATE "gifts" SET "catalog_id"='gift_default_rose' WHERE "gift_type"='rose' AND "amount"=10;
CREATE INDEX "gifts_catalog_id_idx" ON "gifts"("catalog_id");
