import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import ipaddr from "ipaddr.js";
import fs from "fs";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json" assert { type: "json" };

const DB_PATH = path.join(process.cwd(), "db.json");

// Firebase Admin initialization
let adminApp: admin.app.App;
const serviceAccountKeyJson = (process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT)?.trim();
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();

if (serviceAccountKeyJson) {
  try {
    if (serviceAccountKeyJson.startsWith("firebase-adminsdk") && !serviceAccountKeyJson.includes("{")) {
       console.warn("[Firebase] FIREBASE_SERVICE_ACCOUNT_KEY appears to be a filename or truncated. Please paste the FULL JSON content from your service account key file.");
    } else {
      const serviceAccount = JSON.parse(serviceAccountKeyJson);
      if (serviceAccount.project_id && serviceAccount.project_id !== firebaseConfig.projectId) {
        console.warn(`[Firebase] Warning: Service Account Project ID (${serviceAccount.project_id}) mismatch with config Project ID (${firebaseConfig.projectId}).`);
      }
      adminApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: firebaseConfig.projectId
      }, "custom-sa");
      console.log(`[Firebase] Initialized with Service Account: ${serviceAccount.client_email}`);
    }
  } catch (err: any) {
    console.error("[Firebase] Error parsing FIREBASE_SERVICE_ACCOUNT_KEY JSON:", err.message);
  }
}

if (!adminApp && privateKey && clientEmail) {
  try {
    let formattedKey = privateKey.trim();
    // Remove wrapping quotes if present
    if ((formattedKey.startsWith('"') && formattedKey.endsWith('"')) || (formattedKey.startsWith("'") && formattedKey.endsWith("'"))) {
      formattedKey = formattedKey.slice(1, -1);
    }
    
    // Fix common pasting errors for private keys:
    // 1. Literal \n strings
    formattedKey = formattedKey.replace(/\\n/g, '\n');

    // 2. Clear any weird hidden characters or outer quotes
    formattedKey = formattedKey.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

    // 3. Fix internal formatting and headers
    if (!formattedKey.includes("-----BEGIN PRIVATE KEY-----")) {
      const cleaned = formattedKey.replace(/\s+/g, '');
      // If it's a long base64 string, it's likely the key content
      if (cleaned.length > 500) {
        formattedKey = `-----BEGIN PRIVATE KEY-----\n${cleaned}\n-----END PRIVATE KEY-----`;
      } else {
         throw new Error("Key is too short or invalid format (missing headers)");
      }
    } else {
      // Re-format to ensure it follows strict PEM structure
      const match = formattedKey.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);
      if (match && match[1]) {
        const content = match[1].replace(/\s+/g, '');
        formattedKey = `-----BEGIN PRIVATE KEY-----\n${content}\n-----END PRIVATE KEY-----`;
      }
    }

    adminApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: firebaseConfig.projectId,
        clientEmail: clientEmail,
        privateKey: formattedKey
      }),
      projectId: firebaseConfig.projectId
    }, "env-vars");
    console.log("[Firebase] Initialized with individual Private Key and Client Email.");
  } catch (err: any) {
    const keyPreview = privateKey ? `${privateKey.substring(0, 10)}...${privateKey.substring(privateKey.length - 10)}` : 'null';
    console.error(`[Firebase] Error initializing with individual env vars: ${err.message}. Key size: ${privateKey?.length}, Preview: ${keyPreview}`);
  }
}

if (!adminApp) {
  // Application Default Credentials (managed by AI Studio portal)
  try {
    adminApp = admin.initializeApp({
      projectId: firebaseConfig.projectId
    });
    console.log(`[Firebase] Initialized with default credentials for Project: ${firebaseConfig.projectId}.`);
  } catch (err: any) {
    console.error("[Firebase] Error with default initialization:", err.message);
    // Fallback one last time to project ID only if allowed
  }
}

const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
console.log(`[Firebase] Target Database ID: ${databaseId}`);

let db: admin.firestore.Firestore;
let isFirestoreAvailable = false;

if (adminApp) {
  try {
    db = getFirestore(adminApp, databaseId);
  } catch (e: any) {
    console.error(`[Firebase] Failed to initialize Firestore with ID ${databaseId}, attempting (default). Error: ${e.message}`);
    try {
      db = getFirestore(adminApp, '(default)');
    } catch (e2: any) {
      console.error("[Firebase] Fatal: Could not initialize any Firestore instance.");
    }
  }
}

interface ISPInfo {
  id: string;
  asn?: string;
  name: string;
  logo: string;
  ips: string[];
  activationType: 'default' | 'indefinite' | 'monthly';
  status: 'active' | 'suspended';
  expiresAt?: string;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

const initialIspDatabase: ISPInfo[] = [
  { 
    id: "1", 
    name: "Claro Colombia", 
    logo: "https://upload.wikimedia.org/wikipedia/commons/4/4c/Claro.svg", 
    ips: ["190.157.0.0/16", "186.28.0.0/16", "186.29.0.0/16", "2800:480::/32"],
    activationType: 'default',
    status: 'active'
  },
  { 
    id: "2", 
    name: "Movistar Colombia", 
    logo: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Movistar_logo.svg", 
    ips: ["190.156.0.0/16", "181.137.0.0/16", "200.75.0.0/16", "2800:af::/32"],
    activationType: 'default',
    status: 'active'
  },
  { 
    id: "3", 
    name: "Tigo Colombia", 
    logo: "https://upload.wikimedia.org/wikipedia/commons/3/36/Logo_Tigo.svg", 
    ips: ["181.134.0.0/16", "181.133.0.0/16", "181.129.0.0/16", "2800:1e0::/32"],
    activationType: 'default',
    status: 'active'
  },
  { 
    id: "4", 
    name: "ETB", 
    logo: "https://upload.wikimedia.org/wikipedia/commons/9/9c/Logo_etb.svg", 
    ips: ["181.135.0.0/16", "181.56.0.0/16", "200.21.0.0/16", "2800:40::/32"],
    activationType: 'default',
    status: 'active'
  },
  { 
    id: "5", 
    asn: "273120",
    name: "TICCOL COLOMBIA S.A.S.", 
    logo: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBwgHBgkIBwgKCgkLDRYPDQwMDRsUFRAWIB0iIiAdHx8kKDQsJCYxJx8fLT0tMTU3Ojo6Iys/RD84QzQ5OjcBCgoKDQwNGg8PGjclHyU3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3N//AABEIAFwAXAMBEQACEQEDEQH/xAAbAAEAAgMBAQAAAAAAAAAAAAAABQYDBAcBAv/EADQQAAEDAwIFAwEIAAcAAAAAAAEAAgMEBRESIQYTMUFRB2FxIhQyQlKBkaGxCBUWI2LB0f+EABsBAQACAwEBAAAAAAAAAAAAAAAEBQIDBgEH/8QAMhEAAgIBAgMECAcBAQAAAAAAAAECAxEEIQUSXHUY2LD0pZXt9uLeJ0qxca2W+Vv2OklkZORljZmaeZ50+T7Kst0tla5mti3q1VVj5YvcsajkgIAgPCMjBQGtPb6ScgyQM1Do9v0uHwRugKtc/T6grbkKxtQ9rSQZYnsDg8+QRgg4779j8yq9VOFbh1REt0kLLFZ0fzMdT6b22Ws50dTK2MnL4nsa8e+Ntif1XkNVOFfo/tHtmkrnarO35+Zhl9MKAyao7hU6c7NlY1+B4zsf3W2PELUsPDNM+G0uWVleRmqPTS0yO1Q1NXDn7zG6C0nzjT/AEtdWrtqWE8rxNt+ipueWsPvRsH08tD6SKB0tSHxNwJGFrT58fwsfxVqm5p4yZfg6XWq5LKXv95no+BrbS22ooBNUyRVDg55fozkdCMN2I8hez1dk5qfRo8r0dVcJQxlPvM9l4PttmqhU0j6gyAYOuQYcPcALyzVW2x5ZP4CrR00y5oLfzZYVHJQQBAEAQBAEAQBAEAQBAEAQBAEAQBAEAQBAEAQBAEAQH//2Q==",
    ips: [],
    activationType: 'default',
    status: 'active'
  },
];

const initialSystemConfig = {
  defaultName: "TICCOL SAS",
  defaultLogo: "https://ticcol.com/wp-content/uploads/2021/04/Logo-Ticcol-Colombia-S.A.S.png",
  protectedFiles: [
    { id: "file1", title: "mintic.txt", content: "" },
    { id: "file2", title: "coljuegos.txt", content: "" }
  ]
};

// Seed function to migrate or initialize Firestore
async function seedFirestore() {
  console.log(`[Seeding] Checking Firestore status on database: ${databaseId}...`);
  try {
    const ispsSnap = await db.collection('isps').limit(1).get();
    isFirestoreAvailable = true;
    console.log(`[Firebase] Connection established correctly to ${databaseId}.`);
    
    const configSnap = await db.collection('settings').doc('global').get();
    
    const needsIsps = ispsSnap.empty;
    const needsConfig = !configSnap.exists;

    if (needsIsps || needsConfig) {
      console.log("[Seeding] Seeding required documents...");
      
      let ispsToSeed = initialIspDatabase;
      let configToSeed = initialSystemConfig;

      if (fs.existsSync(DB_PATH)) {
        try {
          const content = fs.readFileSync(DB_PATH, "utf-8");
          if (content.trim()) {
            const localData = JSON.parse(content);
            if (localData.ispDatabase) ispsToSeed = localData.ispDatabase;
            if (localData.systemConfig) configToSeed = localData.systemConfig;
          }
        } catch (e) {
          console.warn("Could not read db.json for seeding", e);
        }
      }

      const batch = db.batch();
      
      if (needsIsps) {
        console.log(`Seeding ${ispsToSeed.length} ISPs...`);
        ispsToSeed.forEach(isp => {
          const ref = db.collection('isps').doc(isp.id);
          batch.set(ref, { 
            ...isp, 
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });
      }

      if (needsConfig) {
        console.log("Seeding system config...");
        const configRef = db.collection('settings').doc('global');
        batch.set(configRef, { 
          ...configToSeed,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      // Ensure connectivity check doc exists
      const testRef = db.collection('test').doc('connection');
      batch.set(testRef, { status: 'online', timestamp: admin.firestore.FieldValue.serverTimestamp() });

      await batch.commit();
      console.log("Firestore seeding successful.");
    } else {
      console.log("Firestore already seeded.");
    }
  } catch (err: any) {
    console.error(`[Seeding] Firestore sync failed for database ${databaseId}:`, err.code, err.message);
    isFirestoreAvailable = false;
  }
}

seedFirestore();

// Helper to read local DB state
function readLocalDB() {
  if (fs.existsSync(DB_PATH)) {
    try {
      const content = fs.readFileSync(DB_PATH, "utf-8");
      if (content.trim()) {
        const parsed = JSON.parse(content);
        return {
          ispDatabase: parsed.ispDatabase || initialIspDatabase,
          systemConfig: parsed.systemConfig || initialSystemConfig
        };
      }
    } catch (e) {
      console.warn("Could not read db.json", e);
    }
  }
  return { ispDatabase: initialIspDatabase, systemConfig: initialSystemConfig };
}

async function getSystemConfig() {
  const fullLocalDb = readLocalDB();
  const localConfig = fullLocalDb.systemConfig || initialSystemConfig;
  if (!isFirestoreAvailable) return localConfig;
  try {
    const configDoc = await db.collection('settings').doc('global').get();
    if (configDoc.exists) {
        const dbConfig = configDoc.data() || {};
        const configToReturn = { ...localConfig, ...dbConfig };
        if (configToReturn.protectedFiles && localConfig.protectedFiles) {
            configToReturn.protectedFiles = configToReturn.protectedFiles.map((f: any) => {
                const localF = localConfig.protectedFiles.find((lf: any) => lf.id === f.id);
                return { ...f, content: localF?.content || "" };
            });
        }
        
        fs.writeFileSync(DB_PATH, JSON.stringify({
          ...fullLocalDb,
          systemConfig: configToReturn
        }, null, 2));

        return configToReturn;
    }
    return localConfig;
  } catch (e) {
    return localConfig;
  }
}

let cachedIsps: ISPInfo[] | null = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 30 * 1000; // 30 seconds

async function getIsps() {
  if (!isFirestoreAvailable) {
    return readLocalDB().ispDatabase;
  }
  const now = Date.now();
  if (cachedIsps && (now - lastCacheUpdate < CACHE_TTL)) {
    return cachedIsps;
  }
  try {
    const ispsSnap = await db.collection('isps').get();
    cachedIsps = ispsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ISPInfo));
    lastCacheUpdate = now;
    
    const fullLocalDb = readLocalDB();
    fs.writeFileSync(DB_PATH, JSON.stringify({
      ...fullLocalDb,
      ispDatabase: cachedIsps
    }, null, 2));

    return cachedIsps;
  } catch (e) {
    console.warn("[Firebase] Error fetching ISPs, falling back to local", e);
    return readLocalDB().ispDatabase;
  }
}

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

  // CORS middleware for Vercel and local development
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const isAllowedVercel = origin.endsWith(".vercel.app") || origin === "https://vercel.com";
      const isLocal = origin.startsWith("http://localhost:") || origin.startsWith("https://localhost:") || origin.includes("127.0.0.1");
      const isExternalTarget = origin === "https://bloqueo-isp.vercel.app";

      if (isAllowedVercel || isLocal || isExternalTarget) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
        res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // API to detect ISP
  app.get("/api/detect-isp", async (req, res) => {
    let clientIpStr = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "";
    if (clientIpStr.includes(':') && clientIpStr.includes('.')) {
      clientIpStr = clientIpStr.split(':').pop() || clientIpStr;
    }

    try {
      const config = await getSystemConfig();

      let detectedIsp = {
        id: "default",
        name: config.defaultName,
        logo: config.defaultLogo,
        isDefault: true
      };

      const ispDatabase = await getIsps();
      
      let addr: any = null;
      try {
        addr = ipaddr.parse(clientIpStr);
      } catch (e) {
        // If IP parsing fails, we still return the default ISP
      }
      
      for (const isp of ispDatabase) {
        if (isp.status !== 'active') continue;

        const found = isp.ips.some(range => {
          if (!range) return false;
          try {
            if (range.includes('/')) {
              const [netStr, mask] = range.split('/');
              if (addr) {
                return addr.match(ipaddr.parse(netStr), parseInt(mask));
              }
            } else {
              if (clientIpStr.startsWith(range)) return true;
            }
          } catch (e) { return false; }
          return false;
        });

        if (found) {
          detectedIsp = { ...isp as any, isDefault: false };
          break;
        }
      }
      res.json({ clientIp: clientIpStr, isp: detectedIsp });
    } catch (e) {
      console.error("Detection error:", e);
      res.status(500).json({ error: "No se pudo realizar la detección" });
    }
  });

  app.get("/api/lookup-asn/:asn", async (req, res) => {
    const { asn } = req.params;
    const resource = asn.toUpperCase().startsWith("AS") ? asn : `AS${asn}`;
    try {
      const overviewRes = await fetch(`https://stat.ripe.net/data/as-overview/data.json?resource=${resource}`);
      const overviewData: any = await overviewRes.json();
      const prefixesRes = await fetch(`https://stat.ripe.net/data/announced-prefixes/data.json?resource=${resource}`);
      const prefixesData: any = await prefixesRes.json();

      if (overviewData.status === "ok" && prefixesData.status === "ok") {
        res.json({ 
          name: overviewData.data.holder, 
          prefixes: prefixesData.data.prefixes.map((p: any) => p.prefix)
        });
      } else {
        res.status(404).json({ message: "ASN no encontrado" });
      }
    } catch (error) {
      res.status(500).json({ message: "Error consultando ASN" });
    }
  });

  app.post("/api/admin/reset-isps", async (req, res) => {
    // We allow reset even if Firestore is down, it will just reset the local/cache
    try {
      if (isFirestoreAvailable) {
        const batch = db.batch();
        const oldIsps = await db.collection('isps').get();
        oldIsps.forEach(d => batch.delete(d.ref));
        initialIspDatabase.forEach(isp => {
          const ref = db.collection('isps').doc(isp.id);
          batch.set(ref, { 
            ...isp, 
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });
        const configRef = db.collection('settings').doc('global');
        batch.set(configRef, { 
          ...initialSystemConfig,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await batch.commit();
      }

      // Always update local storage
      fs.writeFileSync(DB_PATH, JSON.stringify({
        ispDatabase: initialIspDatabase,
        systemConfig: initialSystemConfig
      }, null, 2));

      // Clear cache
      cachedIsps = null;
      lastCacheUpdate = 0;

      res.json({ success: true, message: "Base de datos restaurada" });
    } catch (err) {
      console.error("Reset error:", err);
      res.status(500).json({ success: false, message: "Error al restaurar" });
    }
  });

  app.get("/api/admin/status", async (req, res) => {
    // Try a quick check to see if we recovered
    let connectionError = null;
    let fallbackWorked = false;
    let workedDatabaseId = databaseId;

    try {
      if (db) {
        // Try the configured database first
        await db.collection('test').doc('connection').get();
        isFirestoreAvailable = true;
      } else {
        throw new Error("Firestore DB not initialized");
      }
    } catch (e: any) {
      connectionError = e.message;
      isFirestoreAvailable = false;
      
      // If primary failed, try to check if (default) works
      if (databaseId !== '(default)' && adminApp) {
        try {
          const defaultDb = getFirestore(adminApp, '(default)');
          await defaultDb.collection('test').doc('connection').get();
          // If we are here, (default) actually works!
          isFirestoreAvailable = true;
          fallbackWorked = true;
          workedDatabaseId = '(default)';
          connectionError = null;
          // Dynamically switch if we find a working one
          db = defaultDb;
        } catch (err2: any) {
          // Both failed
          connectionError = `Configured DB [${databaseId}] error: ${e.message}. Default DB error: ${err2.message}`;
        }
      }
    }

    const saInfo = (adminApp as any)?.options?.credential?.clientEmail || 'Default ADC / Unknown';
    const saProjectId = (adminApp as any)?.options?.projectId || 'Unknown';

    res.json({
      firestore: isFirestoreAvailable,
      databaseId: workedDatabaseId,
      configuredDatabaseId: databaseId,
      projectId: firebaseConfig.projectId,
      serviceAccountProjectId: saProjectId,
      mode: isFirestoreAvailable ? 'cloud' : 'local',
      error: connectionError,
      fallbackWorked,
      serviceAccount: saInfo,
      env: {
        hasServiceAccountKey: !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
        hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
        hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
        nodeEnv: process.env.NODE_ENV,
        isVercel: !!process.env.VERCEL
      }
    });
  });

  app.get("/api/admin/settings", async (req, res) => {
    try {
      const config = await getSystemConfig();
      res.json(config);
    } catch (e) {
      res.status(500).json({ error: "Error obteniendo configuración" });
    }
  });

  app.get("/api/admin/isps", async (req, res) => {
    try {
      const isps = await getIsps();
      res.json(isps);
    } catch (e) {
      res.status(500).json({ error: "Error listando isps" });
    }
  });

  app.post("/api/admin/isps", async (req, res) => {
    const isp = req.body;
    let syncedToCloud = false;
    try {
      if (!isp.id) isp.id = Date.now().toString();
      
      try {
        await db.collection('isps').doc(isp.id).set({
          ...isp,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        syncedToCloud = true;
        isFirestoreAvailable = true;
      } catch (err: any) {
        console.error("[Firestore] Write failed:", err.message);
        if (err.message.includes("PERMISSION_DENIED")) isFirestoreAvailable = false;
      }
      
      const isps = await getIsps();
      const index = isps.findIndex(i => i.id === isp.id);
      if (index > -1) {
        isps[index] = { ...isps[index], ...isp };
      } else {
        isps.push(isp as ISPInfo);
      }
      
      cachedIsps = isps;
      await persistToLocal();
      res.json({ success: true, isp, firestore: syncedToCloud });
    } catch (e) {
      console.error("Save ISP error:", e);
      res.status(500).json({ error: "Error guardando ISP" });
    }
  });

  app.delete("/api/admin/isps/:id", async (req, res) => {
    const { id } = req.params;
    let syncedToCloud = false;
    try {
      try {
        if (isFirestoreAvailable) {
          await db.collection('isps').doc(id).delete();
          syncedToCloud = true;
        }
      } catch (err: any) {
        console.error("[Firestore] Delete failed:", err.message);
        if (err.message.includes("PERMISSION_DENIED")) isFirestoreAvailable = false;
      }

      const isps = await getIsps();
      const filtered = isps.filter(i => i.id !== id);
      cachedIsps = filtered;
      await persistToLocal();
      res.json({ success: true, firestore: syncedToCloud });
    } catch (e) {
      console.error("Delete ISP error:", e);
      res.status(500).json({ error: "Error eliminando ISP" });
    }
  });

  app.post("/api/admin/settings", async (req, res) => {
    const config = req.body;
    let syncedToCloud = false;
    try {
      try {
        const firestoreConfig = JSON.parse(JSON.stringify(config));
        if (firestoreConfig.protectedFiles) {
          firestoreConfig.protectedFiles = firestoreConfig.protectedFiles.map((f: any) => {
             const { content, ...rest } = f;
             return rest;
          });
        }
        await db.collection('settings').doc('global').set({
          ...firestoreConfig,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        syncedToCloud = true;
        isFirestoreAvailable = true;
      } catch (err: any) {
        console.error("[Firestore] Settings write failed:", err.message);
        if (err.message.includes("PERMISSION_DENIED")) isFirestoreAvailable = false;
      }
      
      const currentConfig = await getSystemConfig();
      const mergedConfig = { ...currentConfig, ...config };
      
      const isps = await getIsps();
      fs.writeFileSync(DB_PATH, JSON.stringify({
        ispDatabase: isps,
        systemConfig: mergedConfig
      }, null, 2));
      
      res.json({ success: true, firestore: syncedToCloud });
    } catch (e) {
      res.status(500).json({ error: "Error guardando configuración" });
    }
  });

  // Helper to save current state to db.json
  const persistToLocal = async () => {
    try {
      const isps = await getIsps();
      const config = await getSystemConfig();
      fs.writeFileSync(DB_PATH, JSON.stringify({
        ispDatabase: isps,
        systemConfig: config
      }, null, 2));
    } catch (e) {
      console.error("Failed to persist to local", e);
    }
  };

  async function startServer() {
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    if (!process.env.VERCEL) {
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
      });
    }
  }

  if (!process.env.VERCEL) {
    startServer();
  }

  export default app;
