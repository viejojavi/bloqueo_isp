import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
console.log("[Firebase Client] Initializing with Project:", firebaseConfig.projectId, "Database:", (firebaseConfig as any).firestoreDatabaseId);

let currentDb = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

export const getDb = () => currentDb;

export const updateFirestoreDatabase = (newDatabaseId?: string) => {
  if (!newDatabaseId) return currentDb;
  console.log(`[Firebase Client] Updating Firestore Database instance to: ${newDatabaseId}`);
  currentDb = getFirestore(app, newDatabaseId);
  return currentDb;
};

export const auth = getAuth(app);
export const storage = getStorage(app);

// Connectivity check
async function testConnection() {
  try {
    await getDocFromServer(doc(currentDb, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration or connection.");
    }
  }
}
testConnection();
