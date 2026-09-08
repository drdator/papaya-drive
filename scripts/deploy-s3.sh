#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export AWS_PROFILE="${AWS_PROFILE:-roventskij}"
export AWS_DEFAULT_REGION=eu-north-1
bucket=papaya-drive-779045249836
distribution=E1XV070WW0P6T

npm run build:static
test -f dist/index.html

# Upload assets before the entry point; retain old chunks for open game tabs.
aws s3 sync dist/ "s3://$bucket/" \
  --exclude 'index.html' \
  --cache-control 'public,max-age=300' --no-progress
aws s3 cp dist/index.html "s3://$bucket/index.html" \
  --content-type 'text/html; charset=utf-8' --cache-control 'no-cache' --no-progress

invalidation=$(aws cloudfront create-invalidation \
  --distribution-id "$distribution" --paths '/*' \
  --query 'Invalidation.Id' --output text)
aws cloudfront wait invalidation-completed \
  --distribution-id "$distribution" --id "$invalidation"
echo 'Deployed: https://d2e17ltpesncil.cloudfront.net'
