import { client } from './client.js';

export const sendMessage = (message, conversationId, context) =>
  client.post('/v1/agent/chat', {
    message, conversation_id: conversationId || null, context: context || null,
  }).then(r => r.data);

export const getSavedPrompts = () =>
  client.get('/v1/agent/saved-prompts').then(r => r.data);

export const savePrompt = (label, prompt_text) =>
  client.post('/v1/agent/saved-prompts', { label, prompt_text }).then(r => r.data);

export const deleteSavedPrompt = (id) =>
  client.delete(`/v1/agent/saved-prompts/${id}`).then(r => r.data);

export const getConversations = () =>
  client.get('/v1/agent/conversations').then(r => r.data);
