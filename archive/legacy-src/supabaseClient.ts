import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Placeholder — replace with `supabase gen types typescript` output when schema is ready.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Database = any

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl) {
  throw new Error('Missing env var: VITE_SUPABASE_URL — check your .env.local file.')
}
if (!supabaseAnonKey) {
  throw new Error('Missing env var: VITE_SUPABASE_ANON_KEY — check your .env.local file.')
}

export const supabase: SupabaseClient<Database> = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
