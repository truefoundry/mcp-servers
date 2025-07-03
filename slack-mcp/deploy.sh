#!/bin/bash

set -eux

# Run formatting and linting
echo "Running formatting and linting..."
yarn format
yarn lint:fix

# Deploy all services
echo "Deploying services..."
tfy deploy --force -f truefoundry.yaml --no-wait

echo "Deployment commands initiated."