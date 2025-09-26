#!/bin/bash
set -e

# Wait for CouchDB to be ready
echo "Waiting for CouchDB to start..."
sleep 5

# Create system databases if they don't exist
for db in _users _replicator _global_changes; do
    if curl -s -f "http://${COUCHDB_USER}:${COUCHDB_PASSWORD}@localhost:5984/$db" > /dev/null; then
        echo "Database $db already exists"
    else
        echo "Creating database $db..."
        curl -f -X PUT "http://${COUCHDB_USER}:${COUCHDB_PASSWORD}@localhost:5984/$db"
    fi
done

# Configure security for system databases
for db in _users _replicator; do
    echo "Setting security for $db..."
    curl -f -X PUT "http://${COUCHDB_USER}:${COUCHDB_PASSWORD}@localhost:5984/$db/_security" \
         -H "Content-Type: application/json" \
         -d '{"admins":{"names":[],"roles":["_admin"]},"members":{"names":[],"roles":["_admin"]}}'
done

echo "CouchDB initialization completed"