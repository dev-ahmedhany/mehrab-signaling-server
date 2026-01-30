import { EgressClient, EgressStatus, RoomServiceClient } from 'livekit-server-sdk';
import { config } from '../config';
import winston from 'winston';

// Setup structured logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

// Cleanup orphaned recordings on server start
async function cleanupOrphanedRecordings() {
  try {
    logger.info('Cleaning up orphaned recordings...');
    const egressClient = new EgressClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
    const allEgresses = await egressClient.listEgress({});

    for (const egress of allEgresses) {
      if (egress.status === EgressStatus.EGRESS_STARTING || egress.status === EgressStatus.EGRESS_ACTIVE) {
        try {
          // Check if room still has participants
          const roomService = new RoomServiceClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
          const rooms = await roomService.listRooms([egress.roomName]);
          const room = rooms.length > 0 ? rooms[0] : null;

          if (!room || room.numParticipants <= 1) {
            logger.info(`Stopping orphaned recording ${egress.egressId} for room ${egress.roomName}`);
            await egressClient.stopEgress(egress.egressId);
          }
        } catch (error) {
          logger.error(`Error checking room ${egress.roomName}:`, error);
        }
      }
    }
    logger.info('Orphaned recordings cleanup completed');
  } catch (error) {
    logger.error('Error during orphaned recording cleanup:', error);
  }
}

// Run the cleanup
cleanupOrphanedRecordings().catch(error => logger.error('Failed to cleanup orphaned recordings:', error));
