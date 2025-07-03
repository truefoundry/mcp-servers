#!/bin/bash

set -eux

# Deploy all services
echo "Deploying services..."
tfy deploy --force -f truefoundry.yaml --no-wait

echo "Deployment commands initiated."
