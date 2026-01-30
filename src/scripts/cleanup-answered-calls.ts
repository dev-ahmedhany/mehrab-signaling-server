import admin from 'firebase-admin';
import { config, validateConfig } from '../config';
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

// Initialize Firebase Admin SDK
function initializeFirebase() {
  if (!admin.apps.length) {
    if (config.firebase.projectId && config.firebase.clientEmail && config.firebase.privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: config.firebase.projectId,
          clientEmail: config.firebase.clientEmail,
          privateKey: config.firebase.privateKey,
        }),
      });
      logger.info('Firebase Admin SDK initialized');
    } else {
      throw new Error('Firebase credentials not configured');
    }
  }
}

// Cleanup answered calls that are older than 3 hours
async function cleanupAnsweredCalls() {
  try {
    logger.info('Starting cleanup of answered calls older than 3 hours...');

    const db = admin.firestore();
    const callsCollection = db.collection('calls'); // Assuming collection name is 'calls'

    // Calculate timestamp for 3 hours ago
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

    // Query for calls with status 'answered' and answeredTime < threeHoursAgo
    const query = callsCollection
      .where('status', '==', 'answered')
      .where('answeredTime', '<', admin.firestore.Timestamp.fromDate(threeHoursAgo));

    const snapshot = await query.get();

    if (snapshot.empty) {
      logger.info('No answered calls older than 3 hours found.');
      return;
    }

    logger.info(`Found ${snapshot.size} answered calls older than 3 hours.`);

    const batch = db.batch();
    let updateCount = 0;

    snapshot.forEach((doc) => {
      const callData = doc.data();
      logger.info(`Ending call ${doc.id}: answered at ${callData.answeredTime?.toDate()}`);
      batch.update(doc.ref, {
        status: 'ended',
        endedTime: admin.firestore.FieldValue.serverTimestamp(),
      });
      updateCount++;
    });

    await batch.commit();

    logger.info(`Successfully ended ${updateCount} calls.`);
  } catch (error) {
    logger.error('Error during cleanup of answered calls:', error);
    throw error;
  }
}

// Main function
async function main() {
  try {
    validateConfig();
    initializeFirebase();
    await cleanupAnsweredCalls();
    logger.info('Cleanup completed successfully.');
  } catch (error) {
    logger.error('Cleanup failed:', error);
    process.exit(1);
  }
}

// Run the cleanup
main();