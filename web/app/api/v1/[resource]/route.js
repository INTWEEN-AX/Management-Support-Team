import {context,body,allowWrite,checked,tableFor,dbError,response,failure,SELECTS,ApiError} from '../../../../lib/api-server.js';
export const dynamic='force-dynamic';
export async function GET(request,{params}){try{
  const {resource}=await params;const table=tableFor(resource);const {db,profile}=await context(request);
  if(resource==='profiles'&&profile.role!=='admin')throw new ApiError(403,'FORBIDDEN','관리자만 사용자 목록을 볼 수 있습니다.');
  const url=new URL(request.url);const page=Number(url.searchParams.get('page')||'0');if(!Number.isInteger(page)||page<0||page>10000)throw new ApiError(400,'INVALID_PAGE','페이지를 확인하세요.');
  const {data,error,count}=await db.from(table).select(resource==='profiles'?'id,display_name,role,approved,active,created_at,updated_at':SELECTS[resource],{count:'exact'}).order('created_at',{ascending:false}).range(page*100,page*100+99);dbError(error);
  return response({data,count,page});
}catch(e){return failure(e);}}
export async function POST(request,{params}){try{
  const {resource}=await params;const table=tableFor(resource);const {db,profile}=await context(request);allowWrite(profile,resource);
  if(resource==='profiles')throw new ApiError(405,'METHOD_NOT_ALLOWED','프로필은 가입 시 생성됩니다.');
  const input=checked(resource,await body(request));
  if(resource==='generations'){
    for(const [key,tableName] of [['staff_ids','ax_staff'],['performance_ids','ax_performances']]){
      if(!input[key].length)continue;let selectedQuery=db.from(tableName).select('id').in('id',input[key]);if(key==='staff_ids')selectedQuery=selectedQuery.eq('active',true);const {data,error}=await selectedQuery;dbError(error);
      if(data.length!==input[key].length)throw new ApiError(403,'SELECTION_DENIED','선택 자료의 접근 권한을 확인하세요.');
    }
  }
  const {data,error}=await db.from(table).insert({...input,created_by:profile.id}).select(SELECTS[resource]).single();dbError(error);return response({data},201);
}catch(e){return failure(e);}}
