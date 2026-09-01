import { API_BASE } from './config';
import type { ApiError, Conversation, Message, Model, Usage, User } from './types';

const now = () => new Date().toISOString();
const key = 'tah-session-ui-mock-v1';
type State = { user:User|null; models:Model[]; conversations:Conversation[]; messages:Record<string,Message[]>; usage:Usage[]; hidden:string[] };
const initial = ():State => ({ user:null, models:[{id:'m_glm_flash',name:'GLM-4-Flash',provider:'glm',upstream_model_id:'glm-4-flash'},{id:'m_deepseek_chat',name:'DeepSeek Chat',provider:'deepseek',upstream_model_id:'deepseek-chat'}], conversations:[], messages:{}, usage:[], hidden:[] });
const load = ():State => typeof localStorage === 'undefined' ? initial() : JSON.parse(localStorage.getItem(key) || 'null') || initial();
let db = load();
const save = () => { if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(db)); };
const fail = (status:number, code:string, message:string):never => { const e = new Error(message) as ApiError; e.status=status; e.code=code; throw e; };
const user = () => db.user || fail(401,'UNAUTHENTICATED','请先登录');
const own = (id:string) => db.conversations.find(c=>c.id===id && !db.hidden.includes(id)) || fail(404,'NOT_FOUND','会话不存在');
const modelFor = (id:string) => db.models.find(m=>m.id===id) || fail(403,'MODEL_NOT_AUTHORIZED','当前用户无权使用该模型');
export type StreamEvent = {event:'text_delta'|'usage'|'done'|'error'; data:Record<string, unknown>};

/** Mock implementation of /api/v1. It never contacts a backend, Provider, or uses credentials. */
export const mockApi = {
  base: API_BASE,
  async login(username:string, password:string):Promise<User> {
    if (username === 'disabled') fail(403,'ACCOUNT_DISABLED','账号已禁用');
    if (username === 'limited') fail(429,'LOGIN_RATE_LIMITED','登录尝试过多，请稍后再试');
    if (!['alice','admin'].includes(username) || password !== 'demo') fail(401,'INVALID_CREDENTIALS','用户名或密码错误');
    db.user={id:username==='admin'?'u_admin':'u_alice',username,role:username==='admin'?'admin':'user',status:'active'}; save(); return db.user;
  },
  async me(){ return user(); }, async logout(){ db.user=null; save(); },
  async models(){ user(); return db.models; },
  async conversations(){ user(); return db.conversations.filter(c=>!db.hidden.includes(c.id)).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)); },
  async createConversation(model_id:string){ user(); modelFor(model_id); const c:Conversation={id:`c_${Date.now()}`,model_id,title:'新会话',status:'active',updated_at:now()}; db.conversations.unshift(c); db.messages[c.id]=[]; save(); return c; },
  async rename(id:string,title:string){ const c=own(id); c.title=title.trim()||'新会话'; c.updated_at=now(); save(); return c; },
  async remove(id:string){ own(id); db.hidden.push(id); save(); },
  async messages(id:string, since?:string){ own(id); const all=db.messages[id]||[]; const i=since?all.findIndex(m=>m.id===since)+1:0; const items=all.slice(Math.max(0,i),Math.max(0,i)+50); return {items,next_since:items.at(-1)?.id,has_more:i+items.length<all.length}; },
  async usage(from?:string,to?:string,model_id?:string){ user(); return db.usage.filter(x=>(!from||x.started_at>=from)&&(!to||x.started_at<=`${to}T23:59:59.999Z`)&&(!model_id||x.model_id===model_id)); },
  async abort(id:string){ const c=own(id); if(c.status!=='generating') fail(409,'NO_ACTIVE_GENERATION','当前没有生成中的回复'); c.status='active'; save(); },
  async *send(id:string, content:string, signal:AbortSignal):AsyncGenerator<StreamEvent> {
    user(); const c=own(id); if(c.status==='readonly') fail(403,'MODEL_NOT_AUTHORIZED','该历史会话已只读'); if(c.status==='generating') fail(409,'CONVERSATION_BUSY','该会话正在生成回复');
    if(content.includes('/limit')) fail(429,'CONCURRENCY_LIMIT','当前生成数量已达到上限');
    c.status='generating'; const request_id=`req_${Date.now()}`; const userMessage:Message={id:`entry_${Date.now()}_u`,role:'user',content,status:'completed',created_at:now()}; (db.messages[id]||=[]).push(userMessage); save();
    if(content.includes('/error')) { c.status='active'; save(); yield {event:'error',data:{request_id,code:'PROVIDER_ERROR',message:'模型服务暂时不可用'}}; return; }
    const answer = `这是对“${content}”的 mock 流式回复。\n\n**模型不会执行消息中的 HTML 或脚本。**`;
    let assembled='';
    for (const token of answer.match(/.{1,8}/g) || []) { if(signal.aborted){ c.status='active'; (db.messages[id]||=[]).push({id:`entry_${Date.now()}_a`,role:'assistant',content:assembled,status:'aborted',created_at:now()}); db.usage.push({request_id,model_id:c.model_id,started_at:now(),status:'aborted',input_tokens:null,output_tokens:null,total_tokens:null}); save(); yield {event:'done',data:{request_id,finish_reason:'aborted'}}; return; } await new Promise(r=>setTimeout(r,80)); assembled+=token; yield {event:'text_delta',data:{request_id,conversation_id:id,delta:token}}; }
    (db.messages[id]||=[]).push({id:`entry_${Date.now()}_a`,role:'assistant',content:assembled,status:'completed',created_at:now()}); db.usage.push({request_id,model_id:c.model_id,started_at:now(),status:'completed',input_tokens:12,output_tokens:18,total_tokens:30}); c.status='active'; c.updated_at=now(); save(); yield {event:'usage',data:{request_id,input_tokens:12,output_tokens:18,total_tokens:30}}; yield {event:'done',data:{request_id,finish_reason:'stop'}};
  },
  // Demo-only control proving a revoked authorization yields a readable but non-sendable history.
  setReadonly(id:string){ const c=own(id); c.status='readonly'; save(); }
};
