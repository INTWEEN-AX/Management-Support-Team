import { createClient } from '@supabase/supabase-js';
import { RESOURCE_TABLES, SELECTS, UUID, validateRecord } from './catalog.js';
const EXPECTED_URL='https://oancjcvjtpbipodewjki.supabase.co';
export class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
export function response(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export function failure(error){const known=error instanceof ApiError;return response({error:{code:known?error.code:'INTERNAL_ERROR',message:known?error.message:'요청을 처리하지 못했습니다. 관리자에게 설정을 확인하세요.'}},known?error.status:500);}
export async function context(request,{pending=false}={}){
  if(!['GET','HEAD'].includes(request.method)){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new ApiError(403,'ORIGIN_DENIED','다른 출처의 변경 요청은 허용하지 않습니다.');}
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(url!==EXPECTED_URL||!key?.startsWith('sb_publishable_'))throw new ApiError(503,'NOT_CONFIGURED','AX 전용 Supabase URL과 publishable key 설정이 필요합니다.');
  const match=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._-]+)$/);
  if(!match||match[1].length>8192)throw new ApiError(401,'UNAUTHENTICATED','로그인이 필요합니다.');
  const db=createClient(url,key,{global:{headers:{Authorization:`Bearer ${match[1]}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.auth.getUser(match[1]);
  if(error||!data?.user)throw new ApiError(401,'INVALID_SESSION','로그인 상태를 확인하세요.');
  const {data:profile,error:pError}=await db.from('ax_profiles').select('id,display_name,role,approved,active,created_at,updated_at').eq('id',data.user.id).maybeSingle();
  if(pError)throw new ApiError(503,'SCHEMA_NOT_READY','AX 스키마와 RLS 적용이 필요합니다.');
  if(!profile)throw new ApiError(403,'PROFILE_REQUIRED','프로필이 없습니다. 관리자에게 문의하세요.');
  if(!profile.active)throw new ApiError(403,'INACTIVE','비활성 계정입니다.');
  if(!pending&&!profile.approved)throw new ApiError(403,'PENDING','관리자 승인 대기 중입니다.');
  return {db,profile,user:data.user};
}
export async function body(request){
  if(!request.headers.get('content-type')?.includes('application/json'))throw new ApiError(415,'JSON_REQUIRED','JSON 요청만 허용합니다.');
  const reader=request.body?.getReader();if(!reader)throw new ApiError(400,'EMPTY_BODY','입력값이 필요합니다.');
  let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw new ApiError(413,'BODY_TOO_LARGE','입력은 64KB 이하만 허용합니다.');}chunks.push(value);}
  try{const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}return JSON.parse(new TextDecoder().decode(all));}catch{throw new ApiError(400,'INVALID_JSON','JSON 형식을 확인하세요.');}
}
export function allowWrite(profile,resource){
  if(resource==='profiles'&&profile.role!=='admin')throw new ApiError(403,'FORBIDDEN','관리자만 권한을 변경할 수 있습니다.');
  if(resource!=='profiles'&&!['admin','editor'].includes(profile.role))throw new ApiError(403,'FORBIDDEN','편집 권한이 필요합니다.');
}
export function checked(resource,input,partial=false){try{return validateRecord(resource,input,{partial});}catch{throw new ApiError(400,'INVALID_RECORD','필수 항목·허용 필드·개인정보 제외 기준을 확인하세요.');}}
export function tableFor(resource){if(!Object.hasOwn(RESOURCE_TABLES,resource))throw new ApiError(404,'NOT_FOUND','지원하지 않는 자료입니다.');return RESOURCE_TABLES[resource];}
export function checkedId(id){if(!UUID.test(id||''))throw new ApiError(400,'INVALID_ID','자료 ID 형식을 확인하세요.');return id;}
export function dbError(error){if(!error)return;if(error.code==='23505')throw new ApiError(409,'DUPLICATE','이미 등록된 자료입니다.');if(['42501','PGRST301'].includes(error.code))throw new ApiError(403,'FORBIDDEN','이 작업을 수행할 권한이 없습니다.');if(['42P01','42703','PGRST205'].includes(error.code))throw new ApiError(503,'SCHEMA_NOT_READY','스키마 적용 또는 설정 확인이 필요합니다.');throw new ApiError(400,'DATABASE_REJECTED','자료의 연결 관계·확인 근거·권한을 확인하세요.');}
export {SELECTS};
