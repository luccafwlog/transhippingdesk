-- Expose confirmed departure/arrival dates alongside the forecast in the
-- customer schedule. The frontend displays actual_value when present.
DROP FUNCTION IF EXISTS public.portal_ship_schedule();
CREATE OR REPLACE FUNCTION public.portal_ship_schedule()
RETURNS TABLE (
  voyage_id bigint,
  vessel_name text,
  voyage text,
  imo_number text,
  port_code text,
  kind text,
  date_value text,
  actual_value text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH visible AS (
    SELECT v.id, ve.name AS vessel_name, v.voyage_number, ve.imo
    FROM public.voyages v
    JOIN public.vessels ve ON ve.id = v.vessel_id
    WHERE v.show_on_portal AND v.status = 'active'
  ),
  latest AS (
    SELECT DISTINCT ON (a.entity_type, a.entity_id, a.field_name)
      a.entity_type, a.entity_id, a.field_name, a.new_value
    FROM public.audit_logs a
    WHERE a.entity_type IN ('voyage_pol_schedule', 'voyage_pod_schedule')
    ORDER BY a.entity_type, a.entity_id, a.field_name, a.changed_at DESC
  ),
  deleted_pods AS (
    SELECT entity_id FROM latest
    WHERE entity_type = 'voyage_pod_schedule'
      AND field_name = 'deleted' AND new_value = 'true'
  ),
  pol AS (
    SELECT split_part(entity_id, '::', 1)::bigint AS vid,
           split_part(entity_id, '::', 2) AS port_code,
           new_value AS etd
    FROM latest
    WHERE entity_type = 'voyage_pol_schedule' AND field_name = 'etd'
      AND new_value IS NOT NULL
  ),
  pol_atd AS (
    SELECT split_part(entity_id, '::', 1)::bigint AS vid,
           split_part(entity_id, '::', 2) AS port_code,
           new_value AS atd
    FROM latest
    WHERE entity_type = 'voyage_pol_schedule' AND field_name = 'atd'
      AND new_value IS NOT NULL
  ),
  pod AS (
    SELECT split_part(l.entity_id, '::', 1)::bigint AS vid,
           split_part(l.entity_id, '::', 2) AS port_code,
           l.new_value AS eta
    FROM latest l
    LEFT JOIN deleted_pods d ON d.entity_id = l.entity_id
    WHERE l.entity_type = 'voyage_pod_schedule' AND l.field_name = 'eta'
      AND l.new_value IS NOT NULL AND d.entity_id IS NULL
  ),
  pod_ata AS (
    SELECT split_part(l.entity_id, '::', 1)::bigint AS vid,
           split_part(l.entity_id, '::', 2) AS port_code,
           l.new_value AS ata
    FROM latest l
    LEFT JOIN deleted_pods d ON d.entity_id = l.entity_id
    WHERE l.entity_type = 'voyage_pod_schedule' AND l.field_name = 'ata'
      AND l.new_value IS NOT NULL AND d.entity_id IS NULL
  )
  SELECT visible.id, visible.vessel_name, visible.voyage_number, visible.imo,
         pol.port_code, 'pol', pol.etd, pol_atd.atd
  FROM visible
  JOIN pol ON pol.vid = visible.id
  LEFT JOIN pol_atd ON pol_atd.vid = pol.vid AND pol_atd.port_code = pol.port_code
  UNION ALL
  SELECT visible.id, visible.vessel_name, visible.voyage_number, visible.imo,
         pod.port_code, 'pod', pod.eta, pod_ata.ata
  FROM visible
  JOIN pod ON pod.vid = visible.id
  LEFT JOIN pod_ata ON pod_ata.vid = pod.vid AND pod_ata.port_code = pod.port_code;
$$;

REVOKE ALL ON FUNCTION public.portal_ship_schedule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_ship_schedule() TO anon, authenticated;
