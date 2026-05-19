import { get, post } from './client.js';

/**
 * Send a chat message to the consumer travel assistant.
 * Hub endpoint: POST /v1/consumer/chat (Bearer <api-key> auth).
 *
 * @param {string} message
 * @param {string|null} conversationId  null = start a new conversation
 * @param {{ currentPage?: string, destination?: string, productTitle?: string }} context
 */
export function sendMessage(message, conversationId = null, context = {}) {
  return post('/v1/consumer/chat', {
    message,
    conversation_id: conversationId,
    context: {
      currentPage:   context.currentPage   || null,
      destination:   context.destination   || null,
      productTitle:  context.productTitle  || null,
    },
  });
}

export function getConversation(conversationId) {
  return get(`/v1/agent/conversations/${conversationId}`);
}
