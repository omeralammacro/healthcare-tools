// ============================================================
//  FIREBASE CONFIGURATION — Fill in YOUR values from Firebase Console
//  Steps:
//    1. Go to https://console.firebase.google.com
//    2. Create a new project (free)
//    3. Go to Project Settings > General > Your apps > Add web app
//    4. Copy the config values below
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyC1oHAmN8_XWqU8S2NIvoFsIQKR0Lxjf_w",
  authDomain: "tools-48cd9.firebaseapp.com",
  projectId: "tools-48cd9",
  storageBucket: "tools-48cd9.firebasestorage.app",
  messagingSenderId: "389263765421",
  appId: "1:389263765421:web:1c523ddfe6cad7d8fabb24",
  measurementId: "G-338D7GY55P"
};

// ============================================================
//  ADMIN EMAIL — Set this to YOUR email address
//  This email will have full admin access to manage all users
// ============================================================
const ADMIN_EMAIL = "nidhi@macrooutsourcing.net";

// ============================================================
//  TOOL DEFINITIONS — Your 3 tools
// ============================================================
const TOOLS = [
  {
    id: "ar_denials_sop",
    name: "AR Denials SOP",
    description: "Standard Operating Procedures for AR Denials in US Healthcare",
    file: "ar_denials_sop.html",
    icon: "📋",
    color: "#1B4F72"
  },
  {
    id: "eligibility_tool",
    name: "Eligibility Leakage Prevention",
    description: "Revenue integrity workflow for eligibility verification and leakage prevention",
    file: "index.html",
    icon: "🛡️",
    color: "#0d7f6e"
  },
  {
    id: "denial_workflow",
    name: "Denial Management Workflow",
    description: "Complete denial management workflow guide for billing operations",
    file: "denial_workflow_guide.html",
    icon: "⚙️",
    color: "#2563a8"
  }
];
