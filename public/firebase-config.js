// Firebase web settings for the live app.
//
// These values are designed to be public: they identify the project but grant
// no access by themselves. Access is controlled by firestore.rules and the
// household allowlist. Never put a private key or password in this file
// (requirement NF-9).
//
// Paste the config from: Firebase console > Project settings > Your apps > Web app.
// Set authDomain to "<project-id>.web.app" so Google sign-in runs on the same
// domain as the app (more reliable on iPhones).
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDKW0Ii_C19irGEJwCwUlGFLpnkoGy7Uu4",
  // Changed from fridge-board-4910c.firebaseapp.com so sign-in happens on the
  // same domain the app is served from (more reliable on iPhones).
  authDomain: "fridge-board-4910c.web.app",
  projectId: "fridge-board-4910c",
  storageBucket: "fridge-board-4910c.firebasestorage.app",
  messagingSenderId: "578420758649",
  appId: "1:578420758649:web:a3c3740b34f599ab8f9ca8",
};

// Optional App Check (requirement NF-11). Paste a reCAPTCHA v3 site key to
// turn it on, then enforce App Check for Firestore in the Firebase console.
export const APPCHECK_SITE_KEY = null;

// Used only when running locally against the Firebase emulators.
export const EMULATOR_CONFIG = {
  apiKey: "demo-key",
  authDomain: "localhost",
  projectId: "demo-fridge-board",
  appId: "demo-app",
};
