export type Role = 'user' | 'admin';
export type User = { id:string; username:string; role:Role; status:'active'|'disabled' };
export type Model = { id:string; name:string; provider:string; upstream_model_id:string };
export type Message = { id:string; role:'user'|'assistant'; content:string; status:'completed'|'aborted'|'error'; created_at:string };
export type Conversation = { id:string; model_id:string; title:string; status:'active'|'readonly'|'generating'; updated_at:string };
export type Usage = { request_id:string; model_id:string; started_at:string; status:'completed'|'aborted'|'error'; input_tokens:number|null; output_tokens:number|null; total_tokens:number|null };
export type ApiError = Error & { status?:number; code?:string };
