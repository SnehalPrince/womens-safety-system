#!/usr/bin/env bash
# Hardware Band Simulation Script for Women's Safety System
# Usage: ./scripts/simulate-band.sh [BASE_URL] [DEVICE_API_KEY] [DEVICE_ID]

BASE="${1:-${BASE:-http://localhost:3000}}"
KEY="${2:-${KEY:-dev_device_api_key_12345}}"
DEVICE="${3:-${DEVICE:-band-001}}"

echo "========================================="
echo " Simulating Hardware Band: $DEVICE"
echo " Base URL: $BASE"
echo "========================================="

echo ""
echo ">> Step 1: Sending sos_start event..."
curl -s -X POST "$BASE/api/location" \
  -H "x-api-key: $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"deviceId\":\"$DEVICE\",\"event\":\"sos_start\",\"lat\":28.6139,\"lng\":77.2090,\"fix\":true}"
echo ""

echo ""
echo ">> Step 2: Polling command endpoint (5s poll)..."
curl -s "$BASE/api/device/$DEVICE/command" \
  -H "x-api-key: $KEY"
echo ""

echo ""
echo ">> Step 3: Sending breadcrumb sos_update event..."
curl -s -X POST "$BASE/api/location" \
  -H "x-api-key: $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"deviceId\":\"$DEVICE\",\"event\":\"sos_update\",\"lat\":28.6148,\"lng\":77.2098,\"fix\":true}"
echo ""

echo ""
echo ">> Step 4: Polling command endpoint again..."
curl -s "$BASE/api/device/$DEVICE/command" \
  -H "x-api-key: $KEY"
echo ""

echo "========================================="
echo " Simulation Complete"
echo "========================================="
