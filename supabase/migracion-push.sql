CREATE OR REPLACE FUNCTION public.registrar_push_suscripcion(p_endpoint text, p_p256dh text, p_auth text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS 'BEGIN INSERT INTO public.push_suscripciones (user_id, endpoint, p256dh, auth) VALUES (auth.uid(), p_endpoint, p_p256dh, p_auth) ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth; RETURN jsonb_build_object(''ok'', true); END;';
GRANT EXECUTE ON FUNCTION public.registrar_push_suscripcion(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.eliminar_push_suscripcion(p_endpoint text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS 'BEGIN DELETE FROM public.push_suscripciones WHERE user_id = auth.uid() AND endpoint = p_endpoint; RETURN jsonb_build_object(''ok'', true); END;';
GRANT EXECUTE ON FUNCTION public.eliminar_push_suscripcion(text) TO authenticated;
