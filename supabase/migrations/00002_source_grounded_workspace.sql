BEGIN;

-- Keep legacy rows for recovery, but quarantine unverified summaries and charts.
-- Remove every legacy policy, including permissive policies added in production.
DO $$ DECLARE p record; f record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'papers' LOOP
    EXECUTE format('DROP POLICY %I ON public.papers', p.policyname);
  END LOOP;
  FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('match_papers', 'get_graph_data') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
  END LOOP;
END $$;
REVOKE ALL ON public.papers FROM anon, authenticated;

CREATE TABLE public.research_papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  identifier text, source_url text, authors text[] NOT NULL DEFAULT '{}', published text, venue text,
  source_kind text NOT NULL CHECK (source_kind IN ('text','pdf','html')),
  coverage text NOT NULL CHECK (coverage IN ('provided_text','document')),
  source_text text NOT NULL CHECK (length(source_text) BETWEEN 100 AND 400000),
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  analysis jsonb, analysis_status text NOT NULL DEFAULT 'pending' CHECK (analysis_status IN ('pending','complete','failed')),
  prompt_version text,
  reading_status text NOT NULL DEFAULT 'unread' CHECK (reading_status IN ('unread','reading','read')),
  tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  search_document tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || source_text)) STORED,
  UNIQUE(owner_id, source_hash), UNIQUE(owner_id, id)
);
CREATE INDEX research_papers_owner_recent ON public.research_papers(owner_id, created_at DESC);
CREATE INDEX research_papers_search ON public.research_papers USING gin(search_document);

CREATE TABLE public.paper_chunks (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  paper_id uuid NOT NULL,
  section text NOT NULL, page integer CHECK (page > 0), ordinal integer NOT NULL CHECK (ordinal >= 0),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 2200),
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset > start_offset),
  FOREIGN KEY(owner_id,paper_id) REFERENCES public.research_papers(owner_id,id) ON DELETE CASCADE,
  UNIQUE(paper_id,ordinal), UNIQUE(owner_id,paper_id,id)
);
CREATE INDEX paper_chunks_owner_paper ON public.paper_chunks(owner_id,paper_id);

CREATE TABLE public.collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200), question text NOT NULL DEFAULT '' CHECK (length(question) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,id)
);
CREATE TABLE public.collection_papers (
  owner_id uuid NOT NULL DEFAULT auth.uid(), collection_id uuid NOT NULL, paper_id uuid NOT NULL,
  PRIMARY KEY(collection_id,paper_id),
  FOREIGN KEY(owner_id,collection_id) REFERENCES public.collections(owner_id,id) ON DELETE CASCADE,
  FOREIGN KEY(owner_id,paper_id) REFERENCES public.research_papers(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX collection_papers_owner ON public.collection_papers(owner_id);
CREATE TABLE public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL DEFAULT auth.uid(), paper_id uuid NOT NULL,
  chunk_id uuid, content text NOT NULL CHECK (length(content) BETWEEN 1 AND 20000), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(owner_id,paper_id) REFERENCES public.research_papers(owner_id,id) ON DELETE CASCADE,
  FOREIGN KEY(owner_id,paper_id,chunk_id) REFERENCES public.paper_chunks(owner_id,paper_id,id) ON DELETE CASCADE
);
CREATE INDEX notes_owner_paper ON public.notes(owner_id,paper_id);
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL DEFAULT auth.uid(), paper_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')), question text CHECK (length(question) <= 2000), answer jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(owner_id,paper_id) REFERENCES public.research_papers(owner_id,id) ON DELETE CASCADE,
  CHECK ((role = 'user' AND question IS NOT NULL AND answer IS NULL) OR (role = 'assistant' AND question IS NULL AND answer IS NOT NULL))
);
CREATE INDEX chat_messages_owner_paper ON public.chat_messages(owner_id,paper_id,created_at);
CREATE TABLE public.research_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL DEFAULT auth.uid(), paper_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('unsupported_claim','incorrect_citation','bad_extraction','missing_context','useful','not_useful')),
  detail text NOT NULL DEFAULT '' CHECK (length(detail) <= 2000), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(owner_id,paper_id) REFERENCES public.research_papers(owner_id,id) ON DELETE CASCADE
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['research_papers','paper_chunks','collections','collection_papers','notes','chat_messages','research_feedback'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY owner_access ON public.%I FOR ALL TO authenticated USING (owner_id = (select auth.uid())) WITH CHECK (owner_id = (select auth.uid()))', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;
-- Source passages are immutable after import. Analysis and personal state may change.
REVOKE UPDATE ON public.paper_chunks FROM authenticated;
REVOKE UPDATE ON public.research_papers FROM authenticated;
GRANT UPDATE(analysis,analysis_status,prompt_version,reading_status,tags) ON public.research_papers TO authenticated;

-- Atomic source + chunk persistence, scoped to the caller by invoker RLS.
CREATE FUNCTION public.save_research_source(document jsonb, passages jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE paper uuid; passage jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF jsonb_array_length(passages) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid passage count'; END IF;
  SELECT id INTO paper FROM public.research_papers WHERE owner_id = auth.uid() AND source_hash = document->>'source_hash';
  IF paper IS NOT NULL THEN RETURN paper; END IF;
  INSERT INTO public.research_papers(id,owner_id,title,identifier,source_url,authors,published,venue,source_kind,coverage,source_text,source_hash)
  VALUES ((document->>'id')::uuid,auth.uid(),document->>'title',document->>'identifier',document->>'source_url',
    ARRAY(SELECT jsonb_array_elements_text(document->'authors')),document->>'published',document->>'venue',document->>'source_kind',document->>'coverage',document->>'source_text',document->>'source_hash')
  ON CONFLICT(owner_id,source_hash) DO NOTHING RETURNING id INTO paper;
  IF paper IS NULL THEN
    SELECT id INTO paper FROM public.research_papers WHERE owner_id = auth.uid() AND source_hash = document->>'source_hash';
    RETURN paper;
  END IF;
  FOR passage IN SELECT jsonb_array_elements(passages) LOOP
    IF substring(document->>'source_text' FROM (passage->>'start_offset')::integer + 1 FOR (passage->>'end_offset')::integer - (passage->>'start_offset')::integer) <> passage->>'text' THEN
      RAISE EXCEPTION 'Passage does not match source';
    END IF;
    INSERT INTO public.paper_chunks(id,owner_id,paper_id,section,page,ordinal,text,start_offset,end_offset)
    VALUES ((passage->>'id')::uuid,auth.uid(),paper,passage->>'section',(passage->>'page')::integer,(passage->>'ordinal')::integer,passage->>'text',(passage->>'start_offset')::integer,(passage->>'end_offset')::integer);
  END LOOP;
  RETURN paper;
END $$;
REVOKE ALL ON FUNCTION public.save_research_source(jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_research_source(jsonb,jsonb) TO authenticated;

-- Persistent atomic quotas; no per-process counters that reset on each invocation.
CREATE TABLE public.research_usage (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL, window_start timestamptz NOT NULL, count integer NOT NULL,
  PRIMARY KEY(owner_id,action,window_start)
);
ALTER TABLE public.research_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.research_usage FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.consume_research_quota(action_name text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE cap integer; used integer; caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  cap := CASE action_name WHEN 'ingest' THEN 10 WHEN 'analyze' THEN 10 WHEN 'chat' THEN 60 WHEN 'synthesize' THEN 10 ELSE NULL END;
  IF cap IS NULL THEN RAISE EXCEPTION 'Unknown action'; END IF;
  INSERT INTO public.research_usage(owner_id,action,window_start,count)
  VALUES(caller,action_name,date_trunc('hour',now()),1)
  ON CONFLICT(owner_id,action,window_start) DO UPDATE SET count = public.research_usage.count + 1 WHERE public.research_usage.count < cap
  RETURNING count INTO used;
  RETURN used IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.consume_research_quota(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_research_quota(text) TO authenticated;
COMMIT;
