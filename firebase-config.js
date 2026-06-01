// ============================================================
// firebase-config.js — مؤسسة شادي الملكاوي | إعداد Firebase
// ============================================================

import { initializeApp }                            from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getDatabase, ref, push, onValue, update,
         remove, get }                              from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { FIREBASE_PATHS }                           from "./constants.js";

const firebaseConfig = {
    apiKey:            "AIzaSyApPv7HfnhBf9gsBvloM9iCsxWxea6WA6I",
    authDomain:        "shadimalkawi-4a159.firebaseapp.com",
    projectId:         "shadimalkawi-4a159",
    storageBucket:     "shadimalkawi-4a159.firebasestorage.app",
    messagingSenderId: "423612053131",
    appId:             "1:423612053131:web:5eb3d867ff2a28fa10068e",
    databaseURL:       "https://shadimalkawi-4a159-default-rtdb.europe-west1.firebasedatabase.app"
};

const firebaseApp = initializeApp(firebaseConfig);
export const db   = getDatabase(firebaseApp);

// ── Database Refs ──────────────────────────────────────────
export const ordersRef        = ref(db, FIREBASE_PATHS.orders);
export const logsRef          = ref(db, FIREBASE_PATHS.logs);
export const warehouseRef     = ref(db, FIREBASE_PATHS.warehouse);
export const returnsRef       = ref(db, FIREBASE_PATHS.returns);
export const purchasesRef     = ref(db, FIREBASE_PATHS.purchases);
export const defPagesRef      = ref(db, FIREBASE_PATHS.defPages);
export const defUsersRef      = ref(db, FIREBASE_PATHS.defUsers);
export const sysUsersRef      = ref(db, 'jawaher_system_users');
export const customColorsRef  = ref(db, 'jawaher_custom_colors');

// ── Re-export Firebase helpers so app.js only imports from here ──
export { ref, push, onValue, update, remove, get };
