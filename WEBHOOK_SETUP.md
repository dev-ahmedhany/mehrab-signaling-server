# LiveKit Webhook Setup Guide

This guide explains how to set up and configure webhooks for the Mehrab Signaling Server to receive real-time events from LiveKit.

## Overview

The webhook endpoint (`/api/livekit/webhook`) allows LiveKit to notify the signaling server about room and participant events. Currently, it handles the following events:
- `room_started`: Logs when a room starts.
- `participant_joined`: Logs when a participant joins (previously triggered recording logic).
- `participant_left`: Logs when a participant leaves (previously stopped recording).
- `room_finished`: Logs when a room ends (previously stopped recording).
- `egress_ended`: Logs when a recording ends.

The webhook validates incoming requests using LiveKit's signature verification for security.

## Prerequisites

- LiveKit server running and accessible.
- Signaling server deployed and accessible (e.g., via HTTPS for production).
- API key and secret from LiveKit (configured in `config.livekit.apiKey` and `config.livekit.apiSecret`).

## Configuration Steps

### 1. Deploy the Signaling Server
Ensure the server is running and the `/api/livekit/webhook` endpoint is accessible. For example:
- Local: `http://localhost:3000/api/livekit/webhook`
- Production: `https://signal.ahmedhany.dev/api/livekit/webhook`

### 2. Configure Webhook in LiveKit
In your LiveKit server configuration or dashboard:
- Set the webhook URL to your signaling server's `/api/livekit/webhook` endpoint.
- Ensure the URL is reachable from LiveKit.

If using LiveKit's self-hosted server, add the webhook section to your `livekit.yaml` config (add it at the end of the file or after the `keys` section):
```yaml
webhook:
  urls:
    - https://signal.ahmedhany.dev/api/livekit/webhook
### 3. Restart the LiveKit Server
After updating `livekit.yaml`, restart the service to apply changes:
```bash
sudo systemctl restart livekit-docker
```

### 4. Verify Configuration
- Start the signaling server.
- Trigger a room event (e.g., create a room and join as a participant).
- Check server logs for webhook event processing (e.g., "Received webhook event: participant_joined").

## Request Format

### Headers
- `Authorization`: Contains the webhook signature for validation.
- `Content-Type`: `application/webhook+json`

### Body
Raw JSON payload from LiveKit, e.g.:
```json
{
  "event": "participant_joined",
  "room": {
    "name": "example-room",
    "numParticipants": 2
  },
  "participant": {
    "identity": "user123"
  }
}
```

## Security

- Webhooks are validated using `WebhookReceiver` from the LiveKit SDK.
- Invalid signatures result in 401 Unauthorized responses.
- Ensure the API key and secret match those in LiveKit.

## Troubleshooting

### Common Issues
- **401 Unauthorized**: Check API key/secret in config and LiveKit setup.
- **No events received**: Verify webhook URL is correct and reachable. Check LiveKit logs.
- **Events logged but no actions**: Code may have been simplified; events are only logged now.

### Logs
Monitor server logs for:
- "Received webhook event: [event] for room: [room]"
- Errors like "Webhook processing error" or "signature validation failed"

### Testing
Use LiveKit's client SDK to simulate events or test with a tool like ngrok for local tunneling.

## Notes
- Rate limited to 1000 requests per minute.
- If recording features were removed, webhooks still log events for monitoring.
- For production, use HTTPS and consider additional security (e.g., IP whitelisting).