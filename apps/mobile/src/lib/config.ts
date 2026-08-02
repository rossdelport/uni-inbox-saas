// Runtime config. EXPO_PUBLIC_* vars are inlined by Expo at bundle time; the
// fallbacks are the production values so a fresh clone runs against prod with
// zero setup. The Supabase anon key is not a secret: it ships inside every
// client bundle by design (the web app publishes the same one), and RLS is
// what actually gates data access.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://tryoneinbox.co";

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://afkgkmhshitfopddadbr.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFma2drbWhzaGl0Zm9wZGRhZGJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MDA0MDEsImV4cCI6MjA5NjM3NjQwMX0.NojauhgcZGTH7KVvo6rCoNqkBYnfV_F34EcIEtwhyUU";
