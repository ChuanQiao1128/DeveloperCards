with candidates as (
 (select 'dispatch'::text phase,p.job_id,p.deck_slug,p.build_id,p.updated_at, p.created_at since_at
 from deck_publishes p left join publish_dispatch d using(job_id)
 where p.status='PENDING' and (p.created_at<statement_timestamp()-interval '10 minutes' or coalesce(d.attempts,0)>=5)
 order by p.created_at,p.job_id limit 21)
 union all
 (select 'processing',p.job_id,p.deck_slug,p.build_id,p.updated_at,p.updated_at
 from deck_publishes p where p.status='PROCESSING' and p.updated_at<statement_timestamp()-interval '30 minutes'
 order by p.updated_at,p.job_id limit 21)
 union all
 (select 'manifest',p.job_id,p.deck_slug,p.build_id,p.updated_at,p.updated_at
 from deck_publishes p join publish_manifest_delivery m using(job_id)
 where p.status='SUCCESS' and (m.state='needs_attention' or (m.state='pending' and p.updated_at<statement_timestamp()-interval '10 minutes'))
 order by p.updated_at,p.job_id limit 21)
) select phase,job_id,deck_slug,build_id,updated_at,since_at from candidates order by since_at,job_id,phase limit 21
