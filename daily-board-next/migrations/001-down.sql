-- Disable new publisher/reader first; export sidecar payloads before rollback.
-- Legacy briefing text and original source journals remain intact.
DROP TABLE IF EXISTS daily_board_reports;
