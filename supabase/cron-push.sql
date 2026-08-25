-- Create wrapper function for pg_cron
CREATE OR REPLACE FUNCTION public.trigger_push_cola()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS 'BEGIN
  PERFORM net.http_post(
    url := ''https://xgfwcrdrkzcoxepnicfb.supabase.co/functions/v1/enviar-push'',
    headers := ''{"Content-Type":"application/json"}''::jsonb,
    body := ''{}''::jsonb
  );
END;';

-- Schedule cron job every minute
SELECT cron.schedule(
  'process-push-cola',
  '* * * * *',
  'SELECT public.trigger_push_cola()'
);
