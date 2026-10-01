const { createClient } = require('@supabase/supabase-js');

// 1. Parse arguments
const args = process.argv.slice(2);
const params = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].substring(2);
    const value = args[i + 1];
    if (value && !value.startsWith('--')) {
      params[key] = value;
      i++;
    }
  }
}

const { email, name, archetype } = params;

// 2. Fail fast with usage message
if (!email || !name || !archetype) {
  console.error('Usage: node scripts/generate_invite.js --email <email> --name <name> --archetype <Visionary|Builder|Enabler>');
  process.exit(1);
}

// 3. Validate archetype
const validArchetypes = ['Visionary', 'Builder', 'Enabler'];
if (!validArchetypes.includes(archetype)) {
  console.error('Error: --archetype must be exactly one of: Visionary, Builder, Enabler');
  process.exit(1);
}

// 4. Validate Environment Variables
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  console.error('Ensure you run this script with these variables set. Do not hardcode secrets.');
  process.exit(1);
}

// 5. Initialize client with service_role key to bypass RLS
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function main() {
  try {
    // 6. Generate Magic Link (this also creates the auth.users identity if it doesn't exist)
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        data: {
          full_name: name,
          role_type: archetype.toLowerCase()
        }
      }
    });

    if (linkError) {
      console.error('Error generating magic link:', linkError.message);
      process.exit(1);
    }

    const user = linkData.user;
    if (!user) {
      console.error('Error: User object not returned by generateLink.');
      process.exit(1);
    }

    // Generate a safe username to comply with CITEXT UNIQUE NOT NULL CHECK
    // Format: alphanumeric up to 20 chars + _ + random digits
    const safeUsername = name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20) + '_' + Math.floor(Math.random() * 10000);

    // 7. Upsert user profile
    // Note: 'email' is intentionally omitted here as it typically belongs to auth.users,
    // and the public.profiles schema does not include an email column.
    const profilePayload = {
      id: user.id,
      full_name: name,
      role_type: archetype.toLowerCase(),
      reputation: 99, // High-tier reputation
      is_verified: true,
      username: safeUsername
    };

    const { error: profileError } = await supabase.from('profiles').upsert(profilePayload, {
      onConflict: 'id'
    });
    
    if (profileError) {
      console.error('Error upserting profile:', profileError.message);
      process.exit(1);
    }

    // 8. Output ONLY the URL and one success confirmation line
    console.log(linkData.properties.action_link);
    console.log(`Success: Golden Invite generated and profile hydrated for ${email} (${archetype}).`);
  } catch (err) {
    console.error('Unexpected error:', err.message);
    process.exit(1);
  }
}

main();
