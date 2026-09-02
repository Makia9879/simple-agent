import { describe, expect, it } from 'vitest';
import { mockApi } from '$lib/mock-api';

describe('session UI mock contract', () => {
 it('models login error classes without exposing internals', async () => {
  await expect(mockApi.login('disabled','demo')).rejects.toMatchObject({status:403,code:'ACCOUNT_DISABLED'});
  await expect(mockApi.login('limited','demo')).rejects.toMatchObject({status:429,code:'LOGIN_RATE_LIMITED'});
  await expect(mockApi.login('alice','bad')).rejects.toMatchObject({status:401});
 });
 it('streams only the four public event types and persists an aborted message', async () => {
  await mockApi.login('alice','demo');
  const conversation=await mockApi.createConversation('m_glm_flash');
  const controller=new AbortController(); const events:string[]=[];
  for await (const event of mockApi.send(conversation.id,'hello',controller.signal)) { events.push(event.event); controller.abort(); }
  expect(events).toEqual(['text_delta','done']);
  const history=await mockApi.messages(conversation.id);
  expect(history.items.some(m=>m.status==='aborted')).toBe(true);
 });
 it('rejects concurrency simulation with stable 429 code', async () => {
  const conversation=await mockApi.createConversation('m_glm_flash');
  const generator=mockApi.send(conversation.id,'/limit',new AbortController().signal);
  await expect(generator.next()).rejects.toMatchObject({status:429,code:'CONCURRENCY_LIMIT'});
 });
 it('keeps revoked histories readable but prevents another prompt', async () => {
  const conversation=await mockApi.createConversation('m_glm_flash');
  mockApi.setReadonly(conversation.id);
  await expect(mockApi.messages(conversation.id)).resolves.toMatchObject({items: []});
  const generator=mockApi.send(conversation.id,'again',new AbortController().signal);
  await expect(generator.next()).rejects.toMatchObject({status:403,code:'MODEL_NOT_AUTHORIZED'});
 });
 it('rejects an ungranted model ID rather than trusting a UI selection', async () => {
  await expect(mockApi.createConversation('m_not_granted')).rejects.toMatchObject({status:403,code:'MODEL_NOT_AUTHORIZED'});
 });
});
