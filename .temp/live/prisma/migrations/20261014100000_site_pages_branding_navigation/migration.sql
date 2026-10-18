CREATE TABLE "site_navigation_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "placement" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "href" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "site_navigation_items_placement_is_active_sort_order_id_idx" ON "site_navigation_items"("placement", "is_active", "sort_order", "id");

CREATE TABLE "site_pages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slug" TEXT NOT NULL UNIQUE,
  "kind" TEXT NOT NULL DEFAULT 'PAGE',
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "blocks_json" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "starts_at" DATETIME,
  "ends_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL
);
CREATE INDEX "site_pages_kind_is_active_starts_at_ends_at_sort_order_idx" ON "site_pages"("kind", "is_active", "starts_at", "ends_at", "sort_order");

CREATE TABLE "site_branding" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'primary',
  "brand_name" TEXT NOT NULL,
  "logo_url" TEXT,
  "accent_from" TEXT NOT NULL,
  "accent_to" TEXT NOT NULL,
  "footer_note" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "updated_at" DATETIME NOT NULL
);
