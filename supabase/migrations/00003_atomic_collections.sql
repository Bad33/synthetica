BEGIN;
CREATE FUNCTION public.save_research_collection(collection_id uuid, collection_title text, research_question text, paper_ids uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE selected uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF cardinality(paper_ids) > 6 THEN RAISE EXCEPTION 'At most six papers per investigation'; END IF;
  INSERT INTO public.collections(id,owner_id,title,question) VALUES(collection_id,auth.uid(),collection_title,research_question)
  ON CONFLICT(id) DO UPDATE SET title = excluded.title, question = excluded.question;
  DELETE FROM public.collection_papers WHERE public.collection_papers.collection_id = save_research_collection.collection_id;
  FOREACH selected IN ARRAY paper_ids LOOP
    INSERT INTO public.collection_papers(owner_id,collection_id,paper_id) VALUES(auth.uid(),collection_id,selected) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN collection_id;
END $$;
REVOKE ALL ON FUNCTION public.save_research_collection(uuid,text,text,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_research_collection(uuid,text,text,uuid[]) TO authenticated;
COMMIT;
