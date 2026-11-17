import {context,response,failure} from '../../../../lib/api-server.js';
export const dynamic='force-dynamic';
export async function GET(request){try{const {profile}=await context(request,{pending:true});return response({data:profile});}catch(e){return failure(e);}}
