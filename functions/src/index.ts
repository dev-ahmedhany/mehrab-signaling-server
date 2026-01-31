/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import {setGlobalOptions} from "firebase-functions";
import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

// Initialize Firebase Admin
admin.initializeApp();

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

// Enforce user busy state based on active calls
export const enforceUserBusyState = onDocumentUpdated("users/{userId}", async (event) => {
  const newData = event.data?.after.data();
  const previousData = event.data?.before.data();
  const userId = event.params.userId;

  // 1. TRIGGER: Only run if isBusy changed from TRUE to FALSE
  // This prevents infinite loops and unnecessary reads.
  if (previousData?.isBusy === true && newData?.isBusy === false) {
    logger.info(`User ${userId} was marked not busy. Verifying...`);

    // 2. CHECK REALITY: Query your active calls collection
    // Since isBusy is only important for teachers, only check teacher calls
    // Check for 'ringing' (incoming call) and 'answered' (active call) statuses
    const teacherCalls = await admin.firestore()
      .collection("calls")
      .where("teacherUid", "==", userId)
      .where("status", "in", ["ringing", "answered"])
      .limit(1)
      .get();

    // 3. ACTION: If an active call exists as teacher, force isBusy back to TRUE
    if (!teacherCalls.empty) {
      logger.info(`Teacher ${userId} is actually still in a call. Reverting isBusy to true.`);

      // Update the document
      await event.data?.after.ref.update({
        isBusy: true,
        lastSystemUpdate: admin.firestore.FieldValue.serverTimestamp() // Optional: for debugging
      });
    }
  }
});
