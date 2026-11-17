'use client';
import { createClient } from '@supabase/supabase-js';
export const PROJECT_REF = 'oancjcvjtpbipodewjki';
export const configured = process.env.NEXT_PUBLIC_SUPABASE_URL === `https://${PROJECT_REF}.supabase.co` && Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_'));
let client;
export function getBrowserClient(){
  if(!configured)return null;
  if(!client)client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:true}});
  return client;
}
