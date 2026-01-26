import admin from 'firebase-admin';

export interface UserInfo {
  uid: string;
  displayName: string;
  photoURL: string | null;
  email?: string;
}

// Cache user info to reduce Firestore reads
const userCache = new Map<string, { data: UserInfo; expiry: number }>();
const CACHE_TTL = 5 * 60 * 60 * 1000; // 5 hours

export async function getUserInfo(uid: string): Promise<UserInfo> {
  // Check cache first
  const cached = userCache.get(uid);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }

  // Default user info for guests
  if (uid.startsWith('guest-')) {
    return {
      uid,
      displayName: 'Guest',
      photoURL: null,
    };
  }

  try {
    const db = admin.firestore();

    // Try to get from users collection
    const userDoc = await db.collection('users').doc(uid).get();

    if (userDoc.exists) {
      const data = userDoc.data();
      const userInfo: UserInfo = {
        uid,
        displayName: data?.name || data?.displayName || 'Unknown User',
        photoURL: data?.profileImage || data?.photoURL || data?.photo || null,
        email: data?.email,
      };

      // Cache the result
      userCache.set(uid, { data: userInfo, expiry: Date.now() + CACHE_TTL });

      return userInfo;
    }

    // Fallback: try Firebase Auth
    try {
      const authUser = await admin.auth().getUser(uid);
      const userInfo: UserInfo = {
        uid,
        displayName: authUser.displayName || authUser.email || 'Unknown User',
        photoURL: authUser.photoURL || null,
        email: authUser.email,
      };

      userCache.set(uid, { data: userInfo, expiry: Date.now() + CACHE_TTL });
      return userInfo;
    } catch {
      // User not found in Auth either
    }

    // Return default
    const defaultInfo: UserInfo = {
      uid,
      displayName: 'Unknown User',
      photoURL: null,
    };

    userCache.set(uid, { data: defaultInfo, expiry: Date.now() + CACHE_TTL });
    return defaultInfo;
  } catch (error) {
    console.error(`Error fetching user info for ${uid}:`, error);

    return {
      uid,
      displayName: 'Unknown User',
      photoURL: null,
    };
  }
}

// Batch fetch multiple users
export async function getUsersInfo(uids: string[]): Promise<Map<string, UserInfo>> {
  const results = new Map<string, UserInfo>();

  // Filter out cached and guest users
  const uncachedUids: string[] = [];

  for (const uid of uids) {
    if (uid.startsWith('guest-')) {
      results.set(uid, { uid, displayName: 'Guest', photoURL: null });
      continue;
    }

    const cached = userCache.get(uid);
    if (cached && cached.expiry > Date.now()) {
      results.set(uid, cached.data);
    } else {
      uncachedUids.push(uid);
    }
  }

  // Fetch uncached users
  if (uncachedUids.length > 0) {
    const db = admin.firestore();

    // Firestore allows max 10 items in 'in' query
    const chunks = [];
    for (let i = 0; i < uncachedUids.length; i += 10) {
      chunks.push(uncachedUids.slice(i, i + 10));
    }

    for (const chunk of chunks) {
      try {
        const snapshot = await db
          .collection('users')
          .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
          .get();

        snapshot.forEach((doc) => {
          const data = doc.data();
          const userInfo: UserInfo = {
            uid: doc.id,
            displayName: data?.name || data?.displayName || 'Unknown User',
            photoURL: data?.profileImage || data?.photoURL || data?.photo || null,
            email: data?.email,
          };

          results.set(doc.id, userInfo);
          userCache.set(doc.id, { data: userInfo, expiry: Date.now() + CACHE_TTL });
        });

        // Set default for users not found
        for (const uid of chunk) {
          if (!results.has(uid)) {
            const defaultInfo: UserInfo = { uid, displayName: 'Unknown User', photoURL: null };
            results.set(uid, defaultInfo);
            userCache.set(uid, { data: defaultInfo, expiry: Date.now() + CACHE_TTL });
          }
        }
      } catch (error) {
        console.error('Error batch fetching users:', error);

        // Set defaults on error
        for (const uid of chunk) {
          if (!results.has(uid)) {
            results.set(uid, { uid, displayName: 'Unknown User', photoURL: null });
          }
        }
      }
    }
  }

  return results;
}

// Clear cache (useful for testing)
export function clearUserCache(): void {
  userCache.clear();
}
