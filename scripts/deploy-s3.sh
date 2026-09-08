#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export AWS_PROFILE="${AWS_PROFILE:-roventskij}"
export AWS_DEFAULT_REGION=eu-north-1
bucket=papaya-drive-779045249836
distribution=E1XV070WW0P6T

npm run build:static
test -f dist/client/index.html

# Upload assets before the entry point; retain old chunks for open game tabs.
aws s3 sync dist/client/ "s3://$bucket/" \
  --exclude '*' --include '_next/*' --include 'models/*.glb' --include 'audio/*' \
  --include 'favicon.svg' --include '404.html' \
  --cache-control 'public,max-age=300' --no-progress
aws s3 cp dist/client/index.rsc "s3://$bucket/index.rsc" \
  --content-type 'text/x-component' --cache-control 'no-cache' --no-progress
aws s3 cp dist/client/index.html "s3://$bucket/index.html" \
  --content-type 'text/html; charset=utf-8' --cache-control 'no-cache' --no-progress

invalidation=$(aws cloudfront create-invalidation \
  --distribution-id "$distribution" --paths '/*' \
  --query 'Invalidation.Id' --output text)
aws cloudfront wait invalidation-completed \
  --distribution-id "$distribution" --id "$invalidation"
echo 'Deployed: https://d2e17ltpesncil.cloudfront.net'
