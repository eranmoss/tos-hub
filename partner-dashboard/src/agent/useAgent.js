import { useState, useCallback, useEffect } from 'react';
import * as agentApi from '../api/agent.js';

export const useAgent = () => {
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState([]);
  const [error, setError] = useState(null);

  const loadSavedPrompts = useCallback(async () => {
    try {
      const { saved_prompts } = await agentApi.getSavedPrompts();
      setSavedPrompts(saved_prompts || []);
    } catch (e) {
      // non-fatal
    }
  }, []);

  useEffect(() => { loadSavedPrompts(); }, [loadSavedPrompts]);

  const sendMessage = useCallback(async (text, context) => {
    if (!text?.trim()) return;
    const now = new Date().toISOString();
    const userMsg = { role: 'user', content: text, ts: now };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);
    try {
      const res = await agentApi.sendMessage(text, conversationId, context);
      setConversationId(res.conversation_id);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: res.response,
        ts: new Date().toISOString(),
        id: res.message_id,
        triggering_user_text: text,
      }]);
    } catch (e) {
      setError(e.response?.data?.error || 'Agent failed to respond');
    } finally {
      setIsLoading(false);
    }
  }, [conversationId]);

  const startNewConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  }, []);

  const saveFavourite = useCallback(async (label, prompt_text) => {
    const saved = await agentApi.savePrompt(label, prompt_text);
    setSavedPrompts(prev => [saved, ...prev]);
    return saved;
  }, []);

  const deleteFavourite = useCallback(async (id) => {
    await agentApi.deleteSavedPrompt(id);
    setSavedPrompts(prev => prev.filter(p => p.id !== id));
  }, []);

  return {
    messages, conversationId, isLoading, error,
    savedPrompts,
    sendMessage, startNewConversation,
    saveFavourite, deleteFavourite,
  };
};
