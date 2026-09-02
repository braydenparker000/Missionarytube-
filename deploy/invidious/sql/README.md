# Invidious creates and migrates its own tables on first start
# (`check_tables: true` in docker-compose.yml), so this directory only
# needs to exist. Drop a .sql file here if you ever need a custom
# migration to run once, before the application starts.
