import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder';

// Client standard (Client-side o Public)
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

// Client Admin (Server-side solo, bypassa RLS)
// Lo inizializziamo come funzione per evitare crash se le env mancano a build-time
export const getSupabaseAdmin = () => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase Admin environment variables are missing.");
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
};