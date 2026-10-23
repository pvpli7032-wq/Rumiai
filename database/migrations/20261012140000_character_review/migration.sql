ALTER TABLE characters ADD COLUMN publication_requested BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE characters ADD COLUMN review_status TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE characters ADD COLUMN review_reason TEXT;
ALTER TABLE characters ADD COLUMN copyright_statement TEXT;
ALTER TABLE characters ADD COLUMN reviewed_by TEXT;
ALTER TABLE characters ADD COLUMN reviewed_at DATETIME;
UPDATE characters SET publication_requested = is_public, review_status = CASE WHEN is_public THEN 'PENDING' ELSE 'DRAFT' END, is_public = false;
UPDATE characters SET is_public = true, publication_requested = true, review_status = 'APPROVED', copyright_statement = '星伴原创虚构角色；头像为项目原创 SVG，仅供内部测试。' WHERE id IN ('xingban-original-0','xingban-original-1','xingban-original-2','xingban-original-3','xingban-original-4','xingban-original-5') AND avatar_url LIKE '/brand/persona-%.svg';
