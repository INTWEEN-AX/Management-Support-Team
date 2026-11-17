import {context,body,allowWrite,checked,checkedId,tableFor,dbError,response,failure,SELECTS,ApiError} from '../../../../../lib/api-server.js';
export const dynamic='force-dynamic';
export async function PATCH(request,{params}){try{
 const {resource,id}=await params;const table=tableFor(resource);checkedId(id);const {db,profile}=await context(request);allowWrite(profile,resource);
 if(resource==='generations')throw new ApiError(405,'IMMUTABLE','생성 이력은 수정할 수 없습니다.');
 const input=checked(resource,await body(request),true);if(!Object.keys(input).length)throw new ApiError(400,'EMPTY_PATCH','변경 항목이 없습니다.');
 if(resource==='profiles'&&id===profile.id&&(input.active===false||input.approved===false||input.role&&input.role!=='admin'))throw new ApiError(409,'KEEP_ADMIN','본인의 관리자 권한을 해제할 수 없습니다.');
 const {data,error}=await db.from(table).update(input).eq('id',id).select(resource==='profiles'?'id,display_name,role,approved,active,created_at,updated_at':SELECTS[resource]).maybeSingle();dbError(error);if(!data)throw new ApiError(404,'NOT_FOUND','자료가 없거나 접근할 수 없습니다.');return response({data});
}catch(e){return failure(e);}}
export async function DELETE(request,{params}){try{
 const {resource,id}=await params;const table=tableFor(resource);checkedId(id);const {db,profile}=await context(request);allowWrite(profile,resource);
 if(['profiles','generations'].includes(resource))throw new ApiError(405,'IMMUTABLE','사용자와 생성 이력은 삭제할 수 없습니다.');
 const {data,error}=await db.from(table).delete().eq('id',id).select('id');dbError(error);if(!data?.length)throw new ApiError(404,'NOT_FOUND','자료가 없거나 접근할 수 없습니다.');return response({data:{id}});
}catch(e){return failure(e);}}
