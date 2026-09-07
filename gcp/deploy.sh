#!/usr/bin/env bash
set -euo pipefail
: "${PROJECT_ID:?Set PROJECT_ID}"; : "${REGION:?Set REGION}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/cinepilot/cinepilot-ai:latest"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
gcloud builds submit --tag "$IMAGE" .
gcloud run deploy cinepilot-ai --image "$IMAGE" --region "$REGION" --platform managed --allow-unauthenticated --port 8080
