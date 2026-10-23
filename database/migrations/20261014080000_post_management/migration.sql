ALTER TABLE "posts" ADD COLUMN "is_pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "posts" ADD COLUMN "is_featured" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "posts_circle_id_status_is_pinned_is_featured_created_at_id_idx" ON "posts"("circle_id","status","is_pinned","is_featured","created_at","id");
CREATE INDEX "posts_status_updated_at_id_idx" ON "posts"("status","updated_at","id");
CREATE INDEX "posts_circle_id_status_updated_at_id_idx" ON "posts"("circle_id","status","updated_at","id");
CREATE INDEX "post_comments_status_updated_at_id_idx" ON "post_comments"("status","updated_at","id");
