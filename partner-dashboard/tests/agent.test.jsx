import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { sendMessage, getSavedPrompts, savePrompt, deleteSavedPrompt, getConversations } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  getSavedPrompts: vi.fn(),
  savePrompt: vi.fn(),
  deleteSavedPrompt: vi.fn(),
  getConversations: vi.fn(async () => ({ conversations: [] })),
}));

vi.mock('../src/api/agent.js', () => ({
  sendMessage, getSavedPrompts, savePrompt, deleteSavedPrompt, getConversations,
}));

import AgentPanel from '../src/agent/AgentPanel.jsx';
import { PageContextProvider } from '../src/agent/usePageContext.js';

const wrap = (ui) => render(<PageContextProvider>{ui}</PageContextProvider>);

beforeEach(() => {
  sendMessage.mockReset();
  getSavedPrompts.mockResolvedValue({ saved_prompts: [] });
  savePrompt.mockReset();
  deleteSavedPrompt.mockReset();
});

describe('Layer 4: AgentPanel', () => {
  it('sends a message and renders response', async () => {
    sendMessage.mockResolvedValueOnce({
      conversation_id: 'c1', message_id: 'm1', response: '**Hello**',
    });
    wrap(<AgentPanel open={true} />);
    const textarea = await screen.findByPlaceholderText(/Ask anything/i);
    await userEvent.type(textarea, 'Status?');
    await userEvent.click(screen.getByRole('button', { name: /Send/i }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('Status?', null, expect.any(Object)));
    await screen.findByText((content) => content.includes('Hello'));
  });

  it('suggested prompts trigger sendMessage', async () => {
    sendMessage.mockResolvedValueOnce({ conversation_id: 'c1', message_id: 'm1', response: 'ok' });
    wrap(<AgentPanel open={true} />);
    const btn = await screen.findByText(/What's my error rate today/i);
    await userEvent.click(btn);
    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
  });

  it('saved prompts load as chips, clicking populates input', async () => {
    getSavedPrompts.mockResolvedValue({
      saved_prompts: [{ id: 'p1', label: 'Errors', prompt_text: 'What errors today?' }],
    });
    wrap(<AgentPanel open={true} />);
    const chipBtn = await screen.findByText(/★ Errors/);
    await userEvent.click(chipBtn);
    const textarea = screen.getByPlaceholderText(/Ask anything/i);
    expect(textarea.value).toBe('What errors today?');
  });

  it('new conversation clears history', async () => {
    sendMessage.mockResolvedValueOnce({ conversation_id: 'c1', message_id: 'm1', response: 'first' });
    wrap(<AgentPanel open={true} />);
    await userEvent.type(screen.getByPlaceholderText(/Ask anything/i), 'hi');
    await userEvent.click(screen.getByRole('button', { name: /Send/i }));
    await screen.findByText('first');
    const newConvBtns = screen.getAllByRole('button', { name: /New conversation/i });
    await userEvent.click(newConvBtns[0]);
    expect(screen.queryByText('first')).not.toBeInTheDocument();
  });
});
