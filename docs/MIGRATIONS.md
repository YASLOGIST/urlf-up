# Database migrations

## Avatar storage (required for profile image uploads)

Apply the current `nexus-schema.sql` in the Supabase SQL editor (or through the
project's migration runner) before deploying this client version. The schema now
creates a public `avatars` Storage bucket with these boundaries:

- WebP only;
- 250 kB maximum object size;
- authenticated users may insert, replace, or delete only objects below their
  own `<auth.uid()>/` folder;
- profile rows continue to store an HTTPS URL, not image bytes.

The script is idempotent. Existing HTTPS `profiles.avatar_url` values remain
valid and require no data migration. The browser writes a stable
`<user-id>/avatar.webp` object and adds a cache-busting query parameter to the
profile URL after each replacement.

### Rollback

Deploy the prior client first. The bucket can then remain safely in place, or be
removed after confirming no `profiles.avatar_url` references its objects. Do not
delete the bucket before migrating those profile URLs.
