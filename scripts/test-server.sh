#!/bin/bash

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SERVER_URL="${1:-http://localhost:3000}"
TURN_DOMAIN="${2:-localhost}"

echo "========================================"
echo "Mehrab Signaling Server Test Script"
echo "========================================"
echo ""
echo "Server URL: $SERVER_URL"
echo "TURN Domain: $TURN_DOMAIN"
echo ""

# Test 1: Health Check
echo -n "1. Health Check... "
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "$SERVER_URL/health" 2>/dev/null)
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | tail -n1)
BODY=$(echo "$HEALTH_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}PASSED${NC}"
    echo "   Response: $BODY"
else
    echo -e "${RED}FAILED${NC}"
    echo "   HTTP Code: $HTTP_CODE"
    echo "   Make sure the server is running: npm run dev"
fi
echo ""

# Test 2: TURN Credentials (without auth - should fail)
echo -n "2. TURN Credentials (no auth)... "
TURN_RESPONSE=$(curl -s -w "\n%{http_code}" "$SERVER_URL/api/turn-credentials" 2>/dev/null)
HTTP_CODE=$(echo "$TURN_RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "401" ]; then
    echo -e "${GREEN}PASSED${NC} (correctly rejected unauthorized request)"
else
    echo -e "${YELLOW}WARNING${NC}"
    echo "   Expected 401, got $HTTP_CODE"
fi
echo ""

# Test 3: WebSocket Connection
echo -n "3. WebSocket Endpoint... "
WS_URL=$(echo "$SERVER_URL" | sed 's/http/ws/')
# Just check if server responds to socket.io polling
SOCKET_RESPONSE=$(curl -s -w "\n%{http_code}" "$SERVER_URL/socket.io/?EIO=4&transport=polling" 2>/dev/null)
HTTP_CODE=$(echo "$SOCKET_RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "400" ]; then
    echo -e "${GREEN}PASSED${NC} (Socket.io endpoint responding)"
else
    echo -e "${RED}FAILED${NC}"
    echo "   HTTP Code: $HTTP_CODE"
fi
echo ""

# Test 4: TURN Server (if not localhost)
if [ "$TURN_DOMAIN" != "localhost" ]; then
    echo -n "4. TURN Server Connectivity... "
    if command -v nc &> /dev/null; then
        if nc -z -w5 "$TURN_DOMAIN" 3478 2>/dev/null; then
            echo -e "${GREEN}PASSED${NC} (port 3478 reachable)"
        else
            echo -e "${RED}FAILED${NC}"
            echo "   Cannot reach $TURN_DOMAIN:3478"
        fi
    else
        echo -e "${YELLOW}SKIPPED${NC} (nc not installed)"
    fi
    echo ""
fi

# Test 5: SSL Certificate (if HTTPS)
if [[ "$SERVER_URL" == https://* ]]; then
    echo -n "5. SSL Certificate... "
    DOMAIN=$(echo "$SERVER_URL" | sed 's|https://||' | cut -d'/' -f1)
    CERT_CHECK=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -dates 2>/dev/null)

    if [ -n "$CERT_CHECK" ]; then
        echo -e "${GREEN}PASSED${NC}"
        echo "   $CERT_CHECK"
    else
        echo -e "${RED}FAILED${NC}"
        echo "   Could not verify SSL certificate"
    fi
    echo ""
fi

echo "========================================"
echo "Test Summary"
echo "========================================"
echo ""
echo "If all tests passed, your server is ready!"
echo ""
echo "Next steps:"
echo "1. Update Flutter app constants with server URL"
echo "2. Run: flutter pub get"
echo "3. Test a call between two devices"
echo ""
