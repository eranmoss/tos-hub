import { sendMessage } from '../../api/agent.js';

/**
 * <tos-agent-chat> — consumer-facing travel assistant chat panel.
 *
 * Attributes:
 *   destination   - current city/destination context (e.g. "Tel Aviv")
 *   product-title - product name when on a detail page
 *   current-page  - hint for the hub prompt (browse|search|detail|booking)
 *   position      - "bottom-right" (default) | "bottom-left" | "inline"
 *
 * Events dispatched:
 *   tos:chat-open  — panel opened
 *   tos:chat-close — panel closed
 */

const SUGGESTED = [
  'What are the top things to do here?',
  'Help me choose between hotels',
  'How far in advance should I book?',
  'What should I know before visiting?',
];

class TosAgentChat extends HTMLElement {
  constructor() {
    super();
    this._open = false;
    this._messages = [];
    this._conversationId = null;
    this._loading = false;
    this._unread = 0;
  }

  connectedCallback() {
    this._render();
    this._bindEvents();
    this._restoreSession();
  }

  disconnectedCallback() {
    this.innerHTML = '';
  }

  // ── Attribute handling ─────────────────────────────────────────────────────

  static get observedAttributes() {
    return ['destination', 'product-title', 'current-page'];
  }

  attributeChangedCallback() {
    this._render();
  }

  get _position() { return this.getAttribute('position') || 'bottom-right'; }
  get _destination() { return this.getAttribute('destination') || ''; }
  get _productTitle() { return this.getAttribute('product-title') || ''; }
  get _currentPage() { return this.getAttribute('current-page') || 'browse'; }

  // ── Session persistence ────────────────────────────────────────────────────

  _restoreSession() {
    try {
      const saved = sessionStorage.getItem('tos_chat_session');
      if (saved) {
        const { messages, conversationId } = JSON.parse(saved);
        this._messages = messages || [];
        this._conversationId = conversationId || null;
        if (this._messages.length) this._render();
      }
    } catch { /* ignore */ }
  }

  _saveSession() {
    try {
      sessionStorage.setItem('tos_chat_session', JSON.stringify({
        messages: this._messages.slice(-20),
        conversationId: this._conversationId,
      }));
    } catch { /* ignore */ }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  _render() {
    const pos = this._position;
    const isInline = pos === 'inline';
    const posClass = isInline ? '' : (pos === 'bottom-left'
      ? 'fixed bottom-5 left-5 z-[9999]'
      : 'fixed bottom-5 right-5 z-[9999]');

    const panelVisible = this._open || isInline;

    this.innerHTML = `
      <div class="${posClass}" style="${isInline ? 'position:relative;width:100%;' : ''}">

        ${!isInline ? this._renderFAB() : ''}

        <!-- Chat panel -->
        <div
          id="tos-chat-panel"
          class="flex flex-col bg-white rounded-2xl shadow-2xl border border-border overflow-hidden
                 transition-all duration-300 ${panelVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}"
          style="width:360px; height:520px; ${isInline ? 'width:100%;height:500px;' : ''} ${!isInline && !panelVisible ? 'transform:translateY(12px)' : ''}"
          aria-live="polite"
        >
          ${this._renderHeader()}
          ${this._renderMessages()}
          ${this._renderInput()}
        </div>
      </div>`;

    // After render: scroll messages to bottom, focus input if open
    requestAnimationFrame(() => {
      const msgs = this.querySelector('#tos-chat-messages');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
      if (panelVisible) {
        const inp = this.querySelector('#tos-chat-input');
        if (inp && document.activeElement !== inp) inp.focus();
      }
    });
  }

  _renderFAB() {
    return `
      <button
        id="tos-chat-fab"
        class="flex items-center gap-2 px-4 py-3 rounded-full shadow-lg
               bg-primary text-white font-medium text-sm
               hover:bg-accent transition-all hover:shadow-xl hover:-translate-y-0.5
               focus:outline-none focus:ring-2 focus:ring-accent/50"
        aria-label="${this._open ? 'Close chat' : 'Open travel assistant'}"
      >
        ${this._open
          ? '<span class="text-base leading-none">✕</span>'
          : `<span class="text-lg leading-none">✈</span>
             <span>Ask a travel expert</span>
             ${this._unread > 0
               ? `<span class="bg-red-500 text-white rounded-full text-[10px] font-bold w-4 h-4 flex items-center justify-center">${this._unread}</span>`
               : ''}`}
      </button>`;
  }

  _renderHeader() {
    return `
      <div class="flex items-center gap-3 px-4 py-3 bg-primary text-white shrink-0">
        <div class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-base">✈</div>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-sm leading-tight">Travel Assistant</div>
          <div class="text-white/60 text-xs truncate">
            ${this._destination ? `Exploring ${this._destination}` : 'Here to help plan your trip'}
          </div>
        </div>
        <button
          id="tos-chat-new"
          title="New conversation"
          class="text-white/60 hover:text-white text-xs px-2 py-1 rounded hover:bg-white/10 transition-colors"
        >New</button>
        ${this.getAttribute('position') !== 'inline' ? `
        <button
          id="tos-chat-close"
          class="text-white/60 hover:text-white ml-1"
          aria-label="Close chat"
        >✕</button>` : ''}
      </div>`;
  }

  _renderMessages() {
    const hasMessages = this._messages.length > 0;
    return `
      <div
        id="tos-chat-messages"
        class="flex-1 overflow-y-auto px-4 py-3 space-y-3 scroll-smooth"
        style="scroll-behavior:smooth"
      >
        ${!hasMessages ? this._renderEmptyState() : this._messages.map(m => this._renderMessage(m)).join('')}
        ${this._loading ? this._renderTyping() : ''}
      </div>`;
  }

  _renderEmptyState() {
    return `
      <div class="text-center pt-4 pb-2">
        <div class="text-4xl mb-2">🌍</div>
        <p class="text-sm font-medium text-text-primary mb-1">Your travel expert is here</p>
        <p class="text-xs text-text-secondary mb-4">Ask me anything about your trip</p>
        <div class="flex flex-col gap-2">
          ${SUGGESTED.map(s => `
            <button
              class="tos-chat-suggestion text-left text-xs px-3 py-2 rounded-lg border border-border
                     hover:border-accent hover:bg-accent/5 transition-colors text-text-secondary hover:text-accent"
              data-suggestion="${s.replace(/"/g, '&quot;')}"
            >${s}</button>
          `).join('')}
        </div>
      </div>`;
  }

  _renderMessage({ role, content, ts }) {
    const isUser = role === 'user';
    const time = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    // Convert basic markdown (bold, line breaks) for display
    const html = content
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');

    if (isUser) {
      return `
        <div class="flex justify-end">
          <div class="max-w-[80%]">
            <div class="bg-accent text-white text-sm rounded-2xl rounded-br-sm px-3 py-2 leading-relaxed">${html}</div>
            <div class="text-[10px] text-text-secondary mt-0.5 text-right">${time}</div>
          </div>
        </div>`;
    }

    return `
      <div class="flex gap-2 items-end">
        <div class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs shrink-0">✈</div>
        <div class="max-w-[82%]">
          <div class="bg-page-bg border border-border text-sm rounded-2xl rounded-bl-sm px-3 py-2 leading-relaxed text-text-primary">${html}</div>
          <div class="text-[10px] text-text-secondary mt-0.5">${time}</div>
        </div>
      </div>`;
  }

  _renderTyping() {
    return `
      <div class="flex gap-2 items-end" id="tos-typing-indicator">
        <div class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs shrink-0">✈</div>
        <div class="bg-page-bg border border-border rounded-2xl rounded-bl-sm px-4 py-3">
          <div class="flex gap-1 items-center">
            <span class="w-1.5 h-1.5 bg-text-secondary rounded-full animate-bounce" style="animation-delay:0ms"></span>
            <span class="w-1.5 h-1.5 bg-text-secondary rounded-full animate-bounce" style="animation-delay:150ms"></span>
            <span class="w-1.5 h-1.5 bg-text-secondary rounded-full animate-bounce" style="animation-delay:300ms"></span>
          </div>
        </div>
      </div>`;
  }

  _renderInput() {
    return `
      <div class="shrink-0 border-t border-border px-3 py-2 bg-white">
        <div class="flex gap-2 items-end">
          <textarea
            id="tos-chat-input"
            rows="1"
            placeholder="Ask anything about your trip…"
            class="flex-1 resize-none text-sm border border-border rounded-xl px-3 py-2
                   focus:outline-none focus:ring-2 focus:ring-accent/30 bg-page-bg
                   max-h-24 leading-relaxed"
            style="overflow-y:hidden"
          ></textarea>
          <button
            id="tos-chat-send"
            class="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center
                   hover:bg-primary transition-colors disabled:opacity-40 shrink-0"
            ${this._loading ? 'disabled' : ''}
            aria-label="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>`;
  }

  // ── Event binding ─────────────────────────────────────────────────────────

  _bindEvents() {
    this.addEventListener('click', (e) => {
      const id = e.target.closest('[id]')?.id;
      const suggestion = e.target.closest('.tos-chat-suggestion');

      if (id === 'tos-chat-fab') { this._toggleOpen(); return; }
      if (id === 'tos-chat-close') { this._close(); return; }
      if (id === 'tos-chat-send') { this._sendFromInput(); return; }
      if (id === 'tos-chat-new') { this._newConversation(); return; }
      if (suggestion) {
        const text = suggestion.dataset.suggestion;
        if (text) this._send(text);
        return;
      }
    });

    this.addEventListener('keydown', (e) => {
      const input = this.querySelector('#tos-chat-input');
      if (e.target === input && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._sendFromInput();
      }
    });

    this.addEventListener('input', (e) => {
      const input = e.target;
      if (input?.id === 'tos-chat-input') {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 96) + 'px';
      }
    });
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  _toggleOpen() {
    this._open = !this._open;
    if (this._open) {
      this._unread = 0;
      this.dispatchEvent(new CustomEvent('tos:chat-open', { bubbles: true }));
    } else {
      this.dispatchEvent(new CustomEvent('tos:chat-close', { bubbles: true }));
    }
    this._render();
    this._bindEvents();
  }

  _close() {
    this._open = false;
    this.dispatchEvent(new CustomEvent('tos:chat-close', { bubbles: true }));
    this._render();
    this._bindEvents();
  }

  _newConversation() {
    this._messages = [];
    this._conversationId = null;
    sessionStorage.removeItem('tos_chat_session');
    this._render();
    this._bindEvents();
  }

  _sendFromInput() {
    const input = this.querySelector('#tos-chat-input');
    const text = input?.value?.trim();
    if (!text || this._loading) return;
    input.value = '';
    input.style.height = 'auto';
    this._send(text);
  }

  async _send(text) {
    const userMsg = { role: 'user', content: text, ts: new Date().toISOString() };
    this._messages.push(userMsg);
    this._loading = true;
    this._render();
    this._bindEvents();

    try {
      const result = await sendMessage(text, this._conversationId, {
        currentPage:  this._currentPage,
        destination:  this._destination,
        productTitle: this._productTitle,
      });

      this._conversationId = result.conversation_id;
      this._messages.push({
        role: 'assistant',
        content: result.response,
        ts: new Date().toISOString(),
      });
      this._saveSession();

      if (!this._open) this._unread++;
    } catch (err) {
      this._messages.push({
        role: 'assistant',
        content: "Sorry, I couldn't connect right now. Please try again.",
        ts: new Date().toISOString(),
      });
    } finally {
      this._loading = false;
      this._render();
      this._bindEvents();
    }
  }
}

customElements.define('tos-agent-chat', TosAgentChat);
