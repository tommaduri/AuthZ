-- Rollback OAuth2 clients table

DROP TRIGGER IF EXISTS oauth2_clients_updated_at ON oauth2_clients;
DROP FUNCTION IF EXISTS update_oauth2_clients_updated_at();
DROP TABLE IF EXISTS oauth2_clients;
