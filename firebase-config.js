// ============================================================
// firebase-config.js — جواهر | إعداد Firebase
// ============================================================

import { initializeApp }                            from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getDatabase, ref, push, onValue, update,
         remove, get }                              from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { FIREBASE_PATHS }                           from "./constants.js";

const firebaseConfig = {
    apiKey:            "AIzaSyCxuFGMSbDEOVjy1buAM4i6XeJ57FIGuiY",
    authDomain:        "goldenpeak-f8a0d.firebaseapp.com",
    projectId:         "goldenpeak-f8a0d",
    storageBucket:     "goldenpeak-f8a0d.firebasestorage.app",
    messagingSenderId: "935788401204",
    appId:             "1:935788401204:web:aa0e4452a22c127e807061",
    databaseURL:       "https://goldenpeak-f8a0d-default-rtdb.europe-west1.firebasedatabase.app"
};

const firebaseApp = initializeApp(firebaseConfig);
export const db   = getDatabase(firebaseApp);

// ── Database Refs ──────────────────────────────────────────
export const ordersRef    = ref(db, FIREBASE_PATHS.orders);
export const logsRef      = ref(db, FIREBASE_PATHS.logs);
export const warehouseRef = ref(db, FIREBASE_PATHS.warehouse);
export const returnsRef   = ref(db, FIREBASE_PATHS.returns);
export const purchasesRef = ref(db, FIREBASE_PATHS.purchases);
export const defPagesRef  = ref(db, FIREBASE_PATHS.defPages);
export const defUsersRef  = ref(db, FIREBASE_PATHS.defUsers);
export const sysUsersRef        = ref(db, 'jawaher_system_users');
export const customColorsRef    = ref(db, 'jawaher_custom_colors');

// ── Re-export Firebase helpers so app.js only imports from here ──
export { ref, push, onValue, update, remove, get };
