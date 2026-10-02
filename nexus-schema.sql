-- ============================================================================
-- URLIFE ⚡ NEXUS SCHEMA v3.0 — PROFILES FOUNDATION
-- "Where Minds Meet" · Visionary · Builder · Enabler
-- Production PostgreSQL · Supabase · Hardened RLS · Frontend-aligned
-- ============================================================================

-- 0. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 1. ENUMS
DO $$ BEGIN
    CREATE TYPE user_role_type AS ENUM ('visionary', 'builder', 'enabler');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. PROFILES TABLE
CREATE TABLE IF NOT EXISTS public.profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username        CITEXT UNIQUE NOT NULL CHECK (
                        char_length(username) BETWEEN 3 AND 32
                        AND username ~ '^[a-zA-Z0-9_]+$'
                    ),
    full_name       TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 80),
    avatar_url      TEXT CHECK (avatar_url IS NULL OR avatar_url ~ '^https?://'),
    role_type       user_role_type NOT NULL DEFAULT 'visionary',
    bio             TEXT CHECK (bio IS NULL OR char_length(bio) <= 160),
    skills          TEXT[] NOT NULL DEFAULT '{}' CHECK (
                        COALESCE(array_length(skills, 1), 0) <= 20
                    ),
    interests       TEXT[] NOT NULL DEFAULT '{}' CHECK (
                        COALESCE(array_length(interests, 1), 0) <= 20
                    ),
    locale          TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
    is_verified     BOOLEAN NOT NULL DEFAULT false,
    reputation      INTEGER NOT NULL DEFAULT 0 CHECK (reputation >= 0),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. INDEXES
CREATE INDEX IF NOT EXISTS idx_profiles_role_type
    ON public.profiles (role_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_skills_gin
    ON public.profiles USING GIN (skills);
CREATE INDEX IF NOT EXISTS idx_profiles_interests_gin
    ON public.profiles USING GIN (interests);
CREATE INDEX IF NOT EXISTS idx_profiles_username_trgm
    ON public.profiles USING GIN (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_fullname_trgm
    ON public.profiles USING GIN (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_last_seen
    ON public.profiles (last_seen_at DESC) WHERE deleted_at IS NULL;

-- 4. ROW LEVEL SECURITY
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_public"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own"     ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own"     ON public.profiles;

CREATE POLICY "profiles_select_public"
    ON public.profiles FOR SELECT
    USING (deleted_at IS NULL);

CREATE POLICY "profiles_insert_own"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- 5. PRIVILEGED COLUMN PROTECTION
CREATE OR REPLACE FUNCTION public.protect_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.role() = 'authenticated' THEN
        NEW.is_verified := OLD.is_verified;
        NEW.reputation  := OLD.reputation;
        NEW.created_at  := OLD.created_at;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_protect ON public.profiles;
CREATE TRIGGER on_profile_protect
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_privileged_columns();

-- 6. UPDATED_AT TRIGGER
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_updated ON public.profiles;
CREATE TRIGGER on_profile_updated
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- 7. AUTO-PROFILE ON SIGNUP (parses register-form metadata)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_username   TEXT;
    v_full_name  TEXT;
    v_role       TEXT;
    v_skills_str TEXT;
    v_skills_arr TEXT[];
    v_attempt    INT := 0;
BEGIN
    v_full_name := btrim(COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'fullName',
        split_part(NEW.email, '@', 1),
        'New Member'
    ));
    IF char_length(v_full_name) < 2 THEN
        v_full_name := 'New Member';
    END IF;
    v_full_name := substring(v_full_name, 1, 80);

    -- The client now sends both `role_type` (schema language) and `role`
    -- (legacy trigger language). Accept either so old confirmation links and
    -- new registrations hydrate identically.
    v_role := lower(COALESCE(
        NEW.raw_user_meta_data->>'role_type',
        NEW.raw_user_meta_data->>'role',
        'visionary'
    ));
    IF v_role NOT IN ('visionary', 'builder', 'enabler') THEN
        v_role := 'visionary';
    END IF;

    -- Skills may arrive as a JSON array (`skills_list`), a CSV string
    -- (`skills`), or a historical CSV mirror (`skills_csv`). Normalise to a
    -- distinct, lower-cased text[] capped to the profiles.skills constraint.
    IF jsonb_typeof(NEW.raw_user_meta_data->'skills_list') = 'array' THEN
        SELECT array_agg(skill) INTO v_skills_arr FROM (
            SELECT DISTINCT lower(btrim(value)) AS skill
            FROM jsonb_array_elements_text(NEW.raw_user_meta_data->'skills_list') AS value
            WHERE btrim(value) <> ''
            LIMIT 20
        ) sub;
    ELSIF jsonb_typeof(NEW.raw_user_meta_data->'skills') = 'array' THEN
        SELECT array_agg(skill) INTO v_skills_arr FROM (
            SELECT DISTINCT lower(btrim(value)) AS skill
            FROM jsonb_array_elements_text(NEW.raw_user_meta_data->'skills') AS value
            WHERE btrim(value) <> ''
            LIMIT 20
        ) sub;
    ELSE
        v_skills_str := COALESCE(
            NEW.raw_user_meta_data->>'skills_csv',
            NEW.raw_user_meta_data->>'skills',
            ''
        );
        SELECT array_agg(skill) INTO v_skills_arr FROM (
            SELECT DISTINCT lower(btrim(unnest)) AS skill
            FROM unnest(string_to_array(v_skills_str, ','))
            WHERE btrim(unnest) <> ''
            LIMIT 20
        ) sub;
    END IF;
    v_skills_arr := COALESCE(v_skills_arr, '{}'::TEXT[]);

    v_username := lower(regexp_replace(
        split_part(NEW.email, '@', 1), '[^a-z0-9_]', '_', 'g'
    ));
    v_username := regexp_replace(v_username, '^_+|_+$', '', 'g');
    IF char_length(v_username) < 3 THEN
        v_username := 'member_' || substr(replace(NEW.id::text, '-', ''), 1, 6);
    END IF;
    v_username := substring(v_username, 1, 32);

    LOOP
        BEGIN
            INSERT INTO public.profiles (id, username, full_name, role_type, skills)
            VALUES (
                NEW.id,
                CASE WHEN v_attempt = 0
                     THEN v_username
                     ELSE substring(v_username, 1, 25) || '_' || substr(md5(random()::text), 1, 6)
                END,
                v_full_name,
                v_role::user_role_type,
                v_skills_arr
            )
            ON CONFLICT (id) DO UPDATE SET
                full_name = EXCLUDED.full_name,
                role_type = EXCLUDED.role_type,
                skills = EXCLUDED.skills;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            v_attempt := v_attempt + 1;
            IF v_attempt >= 5 THEN RAISE; END IF;
        END;
    END LOOP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- 8. PUBLIC SAFE-VIEW (for discovery/matching)
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT id, username, full_name, avatar_url, role_type,
       bio, skills, interests, is_verified, reputation,
       last_seen_at, created_at
FROM public.profiles
WHERE deleted_at IS NULL;

-- 9. PERMISSIONS
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.profiles, public.profiles_public TO anon, authenticated;
GRANT INSERT, UPDATE ON public.profiles TO authenticated;

-- 10. COMMENTS
COMMENT ON TABLE  public.profiles             IS 'UrLife master profiles. Visionary · Builder · Enabler.';
COMMENT ON COLUMN public.profiles.role_type   IS 'visionary (has ideas) · builder (builds) · enabler (funds/connects).';
COMMENT ON COLUMN public.profiles.bio         IS 'Self-description, max 160 chars (frontend-enforced).';
COMMENT ON COLUMN public.profiles.skills      IS 'User-declared abilities. Indexed for matching.';
COMMENT ON COLUMN public.profiles.interests   IS 'User-declared themes. Indexed for matching.';
COMMENT ON COLUMN public.profiles.is_verified IS 'System-controlled. RLS + trigger block user writes.';
COMMENT ON COLUMN public.profiles.reputation  IS 'System-controlled. RLS + trigger block user writes.';
COMMENT ON COLUMN public.profiles.deleted_at  IS 'Soft delete sentinel. NULL = active.';

-- ============================================================================
-- URLIFE ⚡ NEXUS SCHEMA v3.1 — PHASE 2 EXTENSION — IDEAS
-- Visionary's domain · Public discovery · Builder/Enabler matching ready
-- Appends to v3.0 profiles schema. Re-runnable. Production PostgreSQL.
-- ============================================================================

-- 11. ENUMS (PHASE 2)
DO $$ BEGIN
    CREATE TYPE idea_status AS ENUM ('draft', 'open', 'in_progress', 'completed', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 12. IDEAS TABLE
CREATE TABLE IF NOT EXISTS public.ideas (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title               TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    problem_statement   TEXT NOT NULL CHECK (char_length(problem_statement) BETWEEN 20 AND 5000),
    industry            TEXT NOT NULL CHECK (char_length(industry) BETWEEN 1 AND 80),
    required_skills     TEXT[] NOT NULL DEFAULT '{}' CHECK (
                            COALESCE(array_length(required_skills, 1), 0) <= 20
                        ),
    status              idea_status NOT NULL DEFAULT 'draft',
    view_count          INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
    interest_count      INTEGER NOT NULL DEFAULT 0 CHECK (interest_count >= 0),
    is_featured         BOOLEAN NOT NULL DEFAULT false,
    published_at        TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 13. INDEXES (PHASE 2)
CREATE INDEX IF NOT EXISTS idx_ideas_author
    ON public.ideas (author_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ideas_status
    ON public.ideas (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ideas_skills_gin
    ON public.ideas USING GIN (required_skills);
CREATE INDEX IF NOT EXISTS idx_ideas_industry_trgm
    ON public.ideas USING GIN (industry gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ideas_title_trgm
    ON public.ideas USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ideas_feed
    ON public.ideas (published_at DESC NULLS LAST)
    WHERE deleted_at IS NULL AND status IN ('open', 'in_progress', 'completed');
CREATE INDEX IF NOT EXISTS idx_ideas_featured
    ON public.ideas (published_at DESC NULLS LAST)
    WHERE is_featured = true AND deleted_at IS NULL;

-- 14. ROW LEVEL SECURITY (PHASE 2)
ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ideas FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ideas_select_public" ON public.ideas;
DROP POLICY IF EXISTS "ideas_select_own"    ON public.ideas;
DROP POLICY IF EXISTS "ideas_insert_own"    ON public.ideas;
DROP POLICY IF EXISTS "ideas_update_own"    ON public.ideas;

CREATE POLICY "ideas_select_public"
    ON public.ideas FOR SELECT
    USING (
        deleted_at IS NULL
        AND status IN ('open', 'in_progress', 'completed')
    );

CREATE POLICY "ideas_select_own"
    ON public.ideas FOR SELECT
    USING (auth.uid() = author_id);

CREATE POLICY "ideas_insert_own"
    ON public.ideas FOR INSERT
    WITH CHECK (
        auth.uid() = author_id
        AND EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
              AND role_type = 'visionary'
              AND deleted_at IS NULL
        )
    );

CREATE POLICY "ideas_update_own"
    ON public.ideas FOR UPDATE
    USING (auth.uid() = author_id)
    WITH CHECK (auth.uid() = author_id);

-- 15. PRIVILEGED COLUMN PROTECTION + AUTO-PUBLISH (PHASE 2)
CREATE OR REPLACE FUNCTION public.protect_idea_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Lock system-controlled fields from author writes
    IF auth.role() = 'authenticated' THEN
        NEW.view_count     := OLD.view_count;
        NEW.interest_count := OLD.interest_count;
        NEW.is_featured    := OLD.is_featured;
        NEW.author_id      := OLD.author_id;
        NEW.created_at     := OLD.created_at;
    END IF;

    -- Auto-stamp published_at on first publish transition
    IF NEW.status <> 'draft' AND OLD.status = 'draft' AND NEW.published_at IS NULL THEN
        NEW.published_at := now();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_idea_protect ON public.ideas;
CREATE TRIGGER on_idea_protect
    BEFORE UPDATE ON public.ideas
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_idea_privileged_columns();

-- 16. UPDATED_AT TRIGGER (PHASE 2 — reuses v3.0 function)
DROP TRIGGER IF EXISTS on_idea_updated ON public.ideas;
CREATE TRIGGER on_idea_updated
    BEFORE UPDATE ON public.ideas
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- 17. PUBLIC SAFE-VIEW (PHASE 2 — feed-ready with author identity)
CREATE OR REPLACE VIEW public.ideas_public AS
SELECT i.id, i.author_id, i.title, i.problem_statement, i.industry,
       i.required_skills, i.status, i.view_count, i.interest_count,
       i.is_featured, i.published_at, i.created_at, i.updated_at,
       p.username   AS author_username,
       p.full_name  AS author_name,
       p.avatar_url AS author_avatar,
       p.is_verified AS author_verified
FROM public.ideas i
JOIN public.profiles p ON p.id = i.author_id
WHERE i.deleted_at IS NULL
  AND i.status IN ('open', 'in_progress', 'completed')
  AND p.deleted_at IS NULL;

-- 18. PERMISSIONS (PHASE 2)
GRANT SELECT ON public.ideas, public.ideas_public TO anon, authenticated;
GRANT INSERT, UPDATE ON public.ideas TO authenticated;

-- 19. COMMENTS (PHASE 2)
COMMENT ON TABLE  public.ideas                    IS 'UrLife ideas. Visionary-authored, builder/enabler-discoverable.';
COMMENT ON COLUMN public.ideas.author_id          IS 'FK to profiles. Cascades on profile delete. Immutable post-insert.';
COMMENT ON COLUMN public.ideas.title              IS 'Idea title, 1-200 chars (frontend maxlength=200).';
COMMENT ON COLUMN public.ideas.problem_statement  IS 'Problem detail, 20-5000 chars (frontend min=20, maxlength=5000).';
COMMENT ON COLUMN public.ideas.industry           IS 'Single industry tag, 1-80 chars (frontend maxlength=80).';
COMMENT ON COLUMN public.ideas.required_skills    IS 'Skills needed. GIN-indexed for builder matching.';
COMMENT ON COLUMN public.ideas.status             IS 'draft (private) · open · in_progress · completed · archived.';
COMMENT ON COLUMN public.ideas.view_count         IS 'System-controlled. RLS + trigger block author writes.';
COMMENT ON COLUMN public.ideas.interest_count     IS 'System-controlled. RLS + trigger block author writes.';
COMMENT ON COLUMN public.ideas.is_featured        IS 'System-controlled. Admin-only via service_role.';
COMMENT ON COLUMN public.ideas.published_at       IS 'Auto-stamped by trigger on first draft→non-draft transition.';
COMMENT ON COLUMN public.ideas.deleted_at         IS 'Soft delete sentinel. NULL = active.';

-- ============================================================================
-- URLIFE ⚡ NEXUS SCHEMA v3.2 — PHASE 3 EXTENSION — IDEA_INTERESTS
-- "Minds Meet" primitive · Builder/Enabler taps "I'm in" on a Visionary idea
-- Appends to v3.1 ideas schema. Re-runnable. Production PostgreSQL.
-- ============================================================================

-- 20. ENUMS (PHASE 3)
DO $$ BEGIN
    CREATE TYPE interest_status AS ENUM ('pending', 'acknowledged', 'accepted', 'declined', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 21. IDEA_INTERESTS TABLE
CREATE TABLE IF NOT EXISTS public.idea_interests (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idea_id               UUID NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
    interested_user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role_at_time          user_role_type NOT NULL,
    message               TEXT CHECK (message IS NULL OR char_length(message) <= 500),
    status                interest_status NOT NULL DEFAULT 'pending',
    responded_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idea_id, interested_user_id)
);

-- 22. INDEXES (PHASE 3)
CREATE INDEX IF NOT EXISTS idx_interests_idea_active
    ON public.idea_interests (idea_id)
    WHERE status NOT IN ('withdrawn', 'declined');
CREATE INDEX IF NOT EXISTS idx_interests_user_status
    ON public.idea_interests (interested_user_id, status);
CREATE INDEX IF NOT EXISTS idx_interests_pending
    ON public.idea_interests (idea_id, created_at DESC)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_interests_created
    ON public.idea_interests (created_at DESC);

-- 23. ROW LEVEL SECURITY (PHASE 3)
ALTER TABLE public.idea_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_interests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "interests_select_idea_author" ON public.idea_interests;
DROP POLICY IF EXISTS "interests_select_own"         ON public.idea_interests;
DROP POLICY IF EXISTS "interests_insert_own"         ON public.idea_interests;
DROP POLICY IF EXISTS "interests_update_actor"       ON public.idea_interests;

-- Idea author sees all interests on their own ideas
CREATE POLICY "interests_select_idea_author"
    ON public.idea_interests FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.ideas
            WHERE id = idea_interests.idea_id
              AND author_id = auth.uid()
        )
    );

-- Interested user sees their own expressions
CREATE POLICY "interests_select_own"
    ON public.idea_interests FOR SELECT
    USING (auth.uid() = interested_user_id);

-- Only builder/enabler, on active non-own ideas
CREATE POLICY "interests_insert_own"
    ON public.idea_interests FOR INSERT
    WITH CHECK (
        auth.uid() = interested_user_id
        AND EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
              AND role_type IN ('builder', 'enabler')
              AND deleted_at IS NULL
        )
        AND EXISTS (
            SELECT 1 FROM public.ideas
            WHERE id = idea_interests.idea_id
              AND author_id <> auth.uid()
              AND deleted_at IS NULL
              AND status IN ('open', 'in_progress')
        )
    );

-- Both idea author AND interested user can update (column-level lock via trigger)
CREATE POLICY "interests_update_actor"
    ON public.idea_interests FOR UPDATE
    USING (
        auth.uid() = interested_user_id
        OR EXISTS (
            SELECT 1 FROM public.ideas
            WHERE id = idea_interests.idea_id
              AND author_id = auth.uid()
        )
    )
    WITH CHECK (
        auth.uid() = interested_user_id
        OR EXISTS (
            SELECT 1 FROM public.ideas
            WHERE id = idea_interests.idea_id
              AND author_id = auth.uid()
        )
    );

-- 24. ROLE SNAPSHOT ON INSERT (auto-sets role_at_time, blocks visionaries)
CREATE OR REPLACE FUNCTION public.snapshot_interest_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    SELECT role_type INTO NEW.role_at_time
    FROM public.profiles
    WHERE id = NEW.interested_user_id
      AND deleted_at IS NULL;

    IF NEW.role_at_time IS NULL THEN
        RAISE EXCEPTION 'Profile not found or deleted for user %', NEW.interested_user_id;
    END IF;
    IF NEW.role_at_time = 'visionary' THEN
        RAISE EXCEPTION 'Visionaries cannot express interest in ideas';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_interest_snapshot ON public.idea_interests;
CREATE TRIGGER on_interest_snapshot
    BEFORE INSERT ON public.idea_interests
    FOR EACH ROW
    EXECUTE FUNCTION public.snapshot_interest_role();

-- 25. COLUMN PROTECTION + RESPONDED_AT STAMP (PHASE 3)
CREATE OR REPLACE FUNCTION public.protect_interest_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_author BOOLEAN;
    v_is_owner  BOOLEAN;
BEGIN
    SELECT (author_id = auth.uid()) INTO v_is_author
    FROM public.ideas WHERE id = NEW.idea_id;
    v_is_owner := (auth.uid() = NEW.interested_user_id);

    IF auth.role() = 'authenticated' THEN
        -- Immutable for everyone
        NEW.id                 := OLD.id;
        NEW.idea_id            := OLD.idea_id;
        NEW.interested_user_id := OLD.interested_user_id;
        NEW.role_at_time       := OLD.role_at_time;
        NEW.created_at         := OLD.created_at;

        -- Interested user: can edit message (only while open) and withdraw
        IF v_is_owner AND NOT COALESCE(v_is_author, false) THEN
            IF OLD.status IN ('accepted', 'declined', 'withdrawn') THEN
                NEW.message := OLD.message;
            END IF;
            IF NEW.status <> OLD.status AND NEW.status <> 'withdrawn' THEN
                NEW.status := OLD.status;
            END IF;
            NEW.responded_at := OLD.responded_at;

        -- Idea author: can only set status to acknowledged/accepted/declined
        ELSIF COALESCE(v_is_author, false) AND NOT v_is_owner THEN
            NEW.message := OLD.message;
            IF NEW.status <> OLD.status
               AND NEW.status NOT IN ('acknowledged', 'accepted', 'declined') THEN
                NEW.status := OLD.status;
            END IF;
            IF NEW.status <> OLD.status AND OLD.responded_at IS NULL THEN
                NEW.responded_at := now();
            END IF;

        ELSE
            -- Neither role (shouldn't reach due to RLS, but defense in depth)
            NEW.message      := OLD.message;
            NEW.status       := OLD.status;
            NEW.responded_at := OLD.responded_at;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_interest_protect ON public.idea_interests;
CREATE TRIGGER on_interest_protect
    BEFORE UPDATE ON public.idea_interests
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_interest_columns();

-- 26. UPDATED_AT TRIGGER (PHASE 3 — reuses v3.0 function)
DROP TRIGGER IF EXISTS on_interest_updated ON public.idea_interests;
CREATE TRIGGER on_interest_updated
    BEFORE UPDATE ON public.idea_interests
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- 27. IDEAS_PUBLIC VIEW REBUILD (live interest_count from idea_interests)
CREATE OR REPLACE VIEW public.ideas_public AS
SELECT i.id, i.author_id, i.title, i.problem_statement, i.industry,
       i.required_skills, i.status,
       i.view_count,
       COALESCE((
           SELECT count(*)::INTEGER FROM public.idea_interests
           WHERE idea_id = i.id
             AND status NOT IN ('withdrawn', 'declined')
       ), 0) AS interest_count,
       i.is_featured, i.published_at, i.created_at, i.updated_at,
       p.username    AS author_username,
       p.full_name   AS author_name,
       p.avatar_url  AS author_avatar,
       p.is_verified AS author_verified
FROM public.ideas i
JOIN public.profiles p ON p.id = i.author_id
WHERE i.deleted_at IS NULL
  AND i.status IN ('open', 'in_progress', 'completed')
  AND p.deleted_at IS NULL;

-- 28. AUTHOR'S INTEREST DASHBOARD VIEW (security_invoker = true)
CREATE OR REPLACE VIEW public.interests_for_author
WITH (security_invoker = true) AS
SELECT ii.id, ii.idea_id, ii.interested_user_id, ii.role_at_time,
       ii.message, ii.status, ii.responded_at, ii.created_at, ii.updated_at,
       i.title       AS idea_title,
       i.status      AS idea_status,
       p.username    AS user_username,
       p.full_name   AS user_name,
       p.avatar_url  AS user_avatar,
       p.bio         AS user_bio,
       p.skills      AS user_skills,
       p.is_verified AS user_verified
FROM public.idea_interests ii
JOIN public.ideas i    ON i.id = ii.idea_id    AND i.author_id = auth.uid()
JOIN public.profiles p ON p.id = ii.interested_user_id
WHERE i.deleted_at IS NULL
  AND p.deleted_at IS NULL;

-- 29. PERMISSIONS (PHASE 3)
GRANT SELECT ON public.idea_interests, public.interests_for_author TO authenticated;
GRANT INSERT, UPDATE ON public.idea_interests TO authenticated;

-- 30. COMMENTS (PHASE 3)
COMMENT ON TABLE  public.idea_interests                    IS 'UrLife Minds Meet primitive. Builder/Enabler expresses interest in a Visionary idea.';
COMMENT ON COLUMN public.idea_interests.idea_id            IS 'FK to ideas. Cascades on idea delete.';
COMMENT ON COLUMN public.idea_interests.interested_user_id IS 'FK to profiles. Must be builder or enabler (trigger-enforced).';
COMMENT ON COLUMN public.idea_interests.role_at_time       IS 'Snapshot of user role at expression time. Immutable. Auto-set by trigger.';
COMMENT ON COLUMN public.idea_interests.message            IS 'Optional pitch from interested user, max 500 chars.';
COMMENT ON COLUMN public.idea_interests.status             IS 'pending · acknowledged · accepted · declined · withdrawn.';
COMMENT ON COLUMN public.idea_interests.responded_at       IS 'Auto-stamped by trigger when idea author first changes status.';
COMMENT ON VIEW   public.ideas_public                      IS 'Public feed view. Joins ideas + authors, computes live interest_count.';
COMMENT ON VIEW   public.interests_for_author              IS 'Author dashboard. Sees who expressed interest on their ideas, with full user context.';
