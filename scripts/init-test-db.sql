-- This script runs automatically when the Docker Postgres container first starts.
-- It creates the separate test database so Jest can run against isolated data.
SELECT 'CREATE DATABASE campaign_analytics_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'campaign_analytics_test')\gexec
