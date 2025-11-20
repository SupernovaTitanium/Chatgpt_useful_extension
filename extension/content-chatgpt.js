```javascript
class ExtensionManager {
    constructor() {
        this.scrollContainer = null;
        this.conversationContainer = null;
        
        // Selection explain feature
        this.selectionExplainState = {
            button: null,
            popup: null,
            model: 'fast',
            selectedText: '',
            anchorRect: null,
            turnId: null,
            articleElement: null,
            errorEl: null,
            pending: false,
            modelButtons: new Map(),
            snippetEl: null,
            sendButton: null,
            cancelButton: null
        };
        this.selectionExplainHandlers = {
            onMouseUp: null,
            onKeyUp: null,
            onSelectionChange: null,
            onScroll: null,
            onPointerDown: null,
            onWindowScroll: null,
            onResize: null,
            onOutsideClick: null
        };
        this.selectionExplainCheckTimer = null;
        this.selectionExplainInitialized = false;
        this.selectionExplainPositionRaf = null;
        this.selectionExplainModels = [
            {
                id: 'fast',
                label: 'Fast',
                description: 'Use a quick model for short clarifications.',
                optionSelector: '[data-testid="model-selector-option-gpt-4o-mini"], [data-testid="model-selector-option-gpt-4o-mini-free"]',
                labelPattern: /mini|fast|gpt-4o mini/i
            },
            {
                id: 'default',
                label: 'Default',
                description: 'Ask with the currently selected model.',
                optionSelector: null,
                labelPattern: null
            },
            {
                id: 'reasoning',
                label: 'Reasoning',
                description: 'Prefer deeper reasoning models when available.',
                optionSelector: '[data-testid="model-selector-option-o1-mini"], [data-testid="model-selector-option-o1-preview"], [data-testid="model-selector-option-o1"]',
                labelPattern: /o1|reason/i
            }
        ];

        // Provider Configuration
        this.providers = {
            chatgpt: {
                name: 'ChatGPT',
                host: ['chatgpt.com', 'chat.openai.com'],
                turnSelector: 'article[data-turn-id]',
                userTurnSelector: 'article[data-turn="user"]',
                scrollContainerSelector: null // Auto-detect
            }
        };
        this.currentProvider = this.providers.chatgpt;
    }

    async init() {
        console.log('[ChatGPT Enhancer] Init started');
        
        // Initialize Folders and Prompts IMMEDIATELY
        try {
            if (window.FolderManager) {
                console.log('[ChatGPT Enhancer] Initializing FolderManager');
                this.folderManager = new window.FolderManager();
                this.folderManager.init().then(() => {
                    console.log('[ChatGPT Enhancer] Rendering Folders');
                    this.folderManager.render();
                });
            } else {
                console.error('[ChatGPT Enhancer] window.FolderManager not found');
            }
            if (window.PromptManager) {
                console.log('[ChatGPT Enhancer] Initializing PromptManager');
                this.promptManager = new window.PromptManager();
                this.promptManager.init().then(() => {
                    console.log('[ChatGPT Enhancer] Rendering Prompts');
                    this.promptManager.render();
                });
            } else {
                console.error('[ChatGPT Enhancer] window.PromptManager not found');
            }
        } catch (e) {
            console.error('[ChatGPT Enhancer] Error initializing UI managers:', e);
        }

        // Setup Quick Learn (Selection Explain) Feature
        // We still need to find the scroll container for positioning logic if needed, 
        // but we don't need the full timeline critical elements check to block everything.
        await this.findCriticalElements(); 
        this.setupSelectionExplainFeature();
    }

    async findCriticalElements() {
        const selector = this.currentProvider.turnSelector;
        // Don't block indefinitely, just try to find it
        const firstTurn = document.querySelector(selector);
        if (!firstTurn) return false;

        this.conversationContainer = firstTurn.parentElement;
        if (!this.conversationContainer) return false;

        let parent = this.conversationContainer;
        while (parent && parent !== document.body) {
            const style=window.getComputedStyle(parent);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                this.scrollContainer = parent;
                break;
            }
            parent = parent.parentElement;
        }
        return this.scrollContainer !== null;
    }

    // --- Selection Explain Feature ---

    setupSelectionExplainFeature() {
        if (this.selectionExplainInitialized) return;
        this.selectionExplainInitialized = true;

        this.selectionExplainHandlers.onMouseUp = (e) => this.handleSelectionExplainCheck(e);
        this.selectionExplainHandlers.onKeyUp = (e) => this.handleSelectionExplainCheck(e);
        this.selectionExplainHandlers.onSelectionChange = () => this.refreshSelectionExplainButton();
        
        // Use capture for scroll to handle all scrolling elements
        document.addEventListener('mouseup', this.selectionExplainHandlers.onMouseUp);
        document.addEventListener('keyup', this.selectionExplainHandlers.onKeyUp);
        document.addEventListener('selectionchange', this.selectionExplainHandlers.onSelectionChange);
        
        // Close popup on resize or scroll
        this.selectionExplainHandlers.onWindowScroll = () => this.hideSelectionExplainButton(true);
        this.selectionExplainHandlers.onResize = () => this.hideSelectionExplainButton(true);
        window.addEventListener('scroll', this.selectionExplainHandlers.onWindowScroll, { capture: true, passive: true });
        window.addEventListener('resize', this.selectionExplainHandlers.onResize, { passive: true });

        // Global click to close popup
        this.selectionExplainHandlers.onOutsideClick = (e) => {
            if (this.selectionExplainState.popup && 
                this.selectionExplainState.popup.style.display !== 'none' &&
                !this.selectionExplainState.popup.contains(e.target) &&
                !e.composedPath().includes(this.selectionExplainState.popup)) {
                this.hideSelectionExplainPopup();
            }
        };
        document.addEventListener('mousedown', this.selectionExplainHandlers.onOutsideClick, true);
    }

    handleSelectionExplainCheck(e) {
        if (this.selectionExplainCheckTimer) clearTimeout(this.selectionExplainCheckTimer);
        this.selectionExplainCheckTimer = setTimeout(() => {
            this.refreshSelectionExplainButton();
        }, 200);
    }

    refreshSelectionExplainButton() {
        // If popup is open, don't hide anything based on selection
        if (this.selectionExplainState.popup && this.selectionExplainState.popup.style.display !== 'none') return;

        const sel = window.getSelection();
        const state = this.selectionExplainState;
        if (!sel || !sel.rangeCount || sel.isCollapsed) {
            this.hideSelectionExplainButton(false);
            return;
        }

        const text = sel.toString().trim();
        if (!text || text.length < 5) {
            this.hideSelectionExplainButton(false);
            return;
        }

        // Check if selection is within a user or assistant message
        let node = sel.anchorNode;
        let validContext = false;
        while (node && node !== document.body) {
            if (node.nodeType === 1 && (node.matches('article') || node.getAttribute('data-message-author-role'))) {
                validContext = true;
                break;
            }
            node = node.parentElement;
        }

        if (!validContext) {
            this.hideSelectionExplainButton(false);
            return;
        }

        state.selectedText = text;
        try {
            const range = sel.getRangeAt(0);
            state.anchorRect = range.getBoundingClientRect();
            this.showSelectionExplainButton();
        } catch (e) {
            this.hideSelectionExplainButton(false);
        }
    }

    showSelectionExplainButton() {
        const state = this.selectionExplainState;
        if (!state.button) {
            const btn = document.createElement('button');
            btn.className = 'selection-explain-btn';
            btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" >
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
    <span>Ask ChatGPT</span>
`;
            btn.style.cssText = `
position: fixed;
z-index: 9999;
background: #10a37f;
color: white;
border: none;
border-radius: 5px;
padding: 6px 10px;
cursor: pointer;
font-size: 13px;
display: flex;
align-items: center;
gap: 6px;
box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
transform: translate(-50%, -100%);
margin-top: -10px;
opacity: 0;
transition: opacity 0.2s;
pointer-events: auto;
`;
            // Prevent mousedown from clearing selection
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openSelectionExplainPopup();
            });
            document.body.appendChild(btn);
            state.button = btn;
        }

        const rect = state.anchorRect;
        if (!rect) return;

        const top = rect.top;
        const left = rect.left + (rect.width / 2);
        
        if (top < 0 || top > window.innerHeight) {
            this.hideSelectionExplainButton(false);
            return;
        }

        state.button.style.top = `${ top } px`;
        state.button.style.left = `${ left } px`;
        state.button.style.display = 'flex';
        // Force reflow
        state.button.offsetHeight;
        state.button.style.opacity = '1';
    }

    hideSelectionExplainButton(force) {
        const state = this.selectionExplainState;
        if (state.popup && state.popup.style.display !== 'none' && !force) return;
        
        if (state.button) {
            state.button.style.opacity = '0';
            setTimeout(() => {
                if (state.button.style.opacity === '0') {
                    state.button.style.display = 'none';
                }
            }, 200);
        }
    }

    openSelectionExplainPopup() {
        const state = this.selectionExplainState;
        this.hideSelectionExplainButton(true);

        if (!state.popup) {
            this.createSelectionExplainPopup();
        }

        // Reset state
        state.pending = false;
        state.model = 'fast'; // default
        if (state.snippetEl) state.snippetEl.textContent = state.selectedText;
        
        // Reset UI
        const content = state.popup.querySelector('.explain-popup-content');
        const answerArea = state.popup.querySelector('.explain-popup-answer');
        const actions = state.popup.querySelector('.explain-popup-actions');
        
        if (content) content.style.display = 'block';
        if (answerArea) {
            answerArea.style.display = 'none';
            answerArea.innerHTML = '';
        }
        if (actions) actions.style.display = 'flex';
        
        // Reset model selection UI
        state.modelButtons.forEach((btn, id) => {
            btn.classList.toggle('active', id === state.model);
        });

        state.popup.style.display = 'flex';
        this.positionSelectionExplainPopup();
    }

    createSelectionExplainPopup() {
        const state = this.selectionExplainState;
        const popup = document.createElement('div');
        popup.className = 'explain-popup';
        popup.style.cssText = `
position: fixed;
z-index: 10000;
background: #202123;
border: 1px solid #4d4d4f;
border-radius: 8px;
width: 380px;
max-height: 500px;
display: flex;
flex-direction: column;
box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
color: #ececf1;
font-family: sans-serif;
overflow: hidden;
`;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
padding: 12px 16px;
border-bottom: 1px solid #4d4d4f;
display: flex;
justify-content: space-between;
align-items: center;
background: #343541;
font-weight: 600;
`;
        header.innerHTML = '<span>Quick Learn</span>';
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = `
background: none;
border: none;
color: #999;
font-size: 20px;
cursor: pointer;
padding: 0;
line-height: 1;
`;
        closeBtn.onclick = () => this.hideSelectionExplainPopup();
        header.appendChild(closeBtn);
        popup.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.style.cssText = `
padding: 16px;
overflow-y: auto;
flex: 1;
`;

        // Selected Text Snippet
        const snippetLabel = document.createElement('div');
        snippetLabel.textContent = 'Selected Context:';
        snippetLabel.style.cssText = 'font-size: 11px; color: #999; margin-bottom: 4px; text-transform: uppercase;';
        body.appendChild(snippetLabel);

        const snippet = document.createElement('div');
        snippet.className = 'explain-popup-snippet';
        snippet.style.cssText = `
background: #40414f;
padding: 8px;
border-radius: 4px;
font-size: 13px;
color: #d1d5db;
margin-bottom: 16px;
max-height: 80px;
overflow-y: auto;
font-style: italic;
`;
        body.appendChild(snippet);
        state.snippetEl = snippet;

        // Content Area (Model Selection)
        const content = document.createElement('div');
        content.className = 'explain-popup-content';
        
        const modelLabel = document.createElement('div');
        modelLabel.textContent = 'Choose Model:';
        modelLabel.style.cssText = 'font-size: 11px; color: #999; margin-bottom: 8px; text-transform: uppercase;';
        content.appendChild(modelLabel);

        const modelList = document.createElement('div');
        modelList.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;';
        
        this.selectionExplainModels.forEach(m => {
            const mBtn = document.createElement('div');
            mBtn.style.cssText = `
padding: 10px;
border: 1px solid #565869;
border-radius: 6px;
cursor: pointer;
transition: all 0.2s;
`;
            mBtn.innerHTML = `
    <div style="font-weight: 600; font-size: 14px; margin-bottom: 2px;" > ${ m.label }</div>
        <div style="font-size: 12px; color: #999;">${m.description}</div>
`;
            mBtn.onclick = () => {
                state.model = m.id;
                state.modelButtons.forEach((b, id) => {
                    b.style.borderColor = (id === m.id) ? '#10a37f' : '#565869';
                    b.style.background = (id === m.id) ? 'rgba(16, 163, 127, 0.1)' : 'transparent';
                });
            };
            state.modelButtons.set(m.id, mBtn);
            modelList.appendChild(mBtn);
        });
        // Set default active
        state.modelButtons.get('fast').click();
        content.appendChild(modelList);
        body.appendChild(content);

        // Answer Area
        const answerArea = document.createElement('div');
        answerArea.className = 'explain-popup-answer';
        answerArea.style.cssText = `
display: none;
font-size: 14px;
line-height: 1.5;
color: #ececf1;
`;
        body.appendChild(answerArea);

        // Error Area
        const errorEl = document.createElement('div');
        errorEl.style.cssText = 'color: #ef4444; font-size: 13px; margin-top: 10px; display: none;';
        body.appendChild(errorEl);
        state.errorEl = errorEl;

        popup.appendChild(body);

        // Footer Actions
        const actions = document.createElement('div');
        actions.className = 'explain-popup-actions';
        actions.style.cssText = `
padding: 12px 16px;
border-top: 1px solid #4d4d4f;
display: flex;
justify-content: flex-end;
gap: 10px;
background: #343541;
`;
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = `
padding: 8px 12px;
background: transparent;
border: 1px solid #565869;
color: white;
border-radius: 4px;
cursor: pointer;
`;
        cancelBtn.onclick = () => {
            this.hideSelectionExplainPopup();
            this.hideSelectionExplainButton(false);
        };
        state.cancelButton = cancelBtn;
        actions.appendChild(cancelBtn);

        const askBtn = document.createElement('button');
        askBtn.textContent = 'Ask ChatGPT';
        askBtn.style.cssText = `
padding: 8px 16px;
background: #10a37f;
border: none;
color: white;
border-radius: 4px;
cursor: pointer;
font-weight: 600;
`;
        askBtn.onclick = () => this.handleSelectionExplainSend();
        state.sendButton = askBtn;
        actions.appendChild(askBtn);

        popup.appendChild(actions);

        document.body.appendChild(popup);
        state.popup = popup;
    }

    positionSelectionExplainPopup() {
        const state = this.selectionExplainState;
        if (!state.popup || !state.anchorRect) return;

        const rect = state.anchorRect;
        const popupRect = state.popup.getBoundingClientRect();
        
        // Position centered below selection
        let top = rect.bottom + 10;
        let left = rect.left + (rect.width / 2) - (popupRect.width / 2);

        // Keep in viewport
        if (left < 10) left = 10;
        if (left + popupRect.width > window.innerWidth - 10) left = window.innerWidth - popupRect.width - 10;
        if (top + popupRect.height > window.innerHeight - 10) {
            // If not enough space below, try above
            const topAbove = rect.top - popupRect.height - 10;
            if (topAbove > 10) top = topAbove;
        }

        state.popup.style.top = `${ top } px`;
        state.popup.style.left = `${ left } px`;
    }

    hideSelectionExplainPopup() {
        if (this.selectionExplainState.popup) {
            this.selectionExplainState.popup.style.display = 'none';
        }
    }

    async handleSelectionExplainSend() {
        const state = this.selectionExplainState;
        if (state.pending) return;
        if (!state.selectedText) return;
        state.pending = true;
        if (state.sendButton) state.sendButton.setAttribute('disabled', 'true');
        if (state.errorEl) state.errorEl.textContent = '';

        // Capture scroll position
        const scrollTop = this.scrollContainer ? this.scrollContainer.scrollTop : null;
        const scrollLeft = this.scrollContainer ? this.scrollContainer.scrollLeft : null;

        // Start aggressive scroll restoration
        this.scrollRestoreTimer = setInterval(() => {
            if (this.scrollContainer && scrollTop !== null) {
                this.scrollContainer.scrollTop = scrollTop;
                if (typeof scrollLeft === 'number') this.scrollContainer.scrollLeft = scrollLeft;
            }
        }, 50);

        try {
            const switched = await this.switchChatGPTModelIfNeeded(state.model);
            if (!switched && state.errorEl) {
                state.errorEl.textContent = 'Selected model is not available right now. Using the current model instead.';
            }

            // Send the prompt
            const ok = await this.sendExplainPrompt(state.selectedText, state.model);
            if (!ok) {
                throw new Error('Failed to send prompt');
            }

            // Switch popup to "Answering" mode
            this.setPopupToAnsweringState();

            // Monitor the response
            await this.monitorResponse((partialText) => {
                this.updatePopupAnswer(partialText);
            });

            // Done
            state.pending = false;
            state.sendButton?.removeAttribute('disabled');
            clearInterval(this.scrollRestoreTimer);

        } catch (err) {
            if (state.errorEl) {
                state.errorEl.textContent = 'Unable to complete request. Please retry.';
            }
            state.pending = false;
            state.sendButton?.removeAttribute('disabled');
            console.error('Explain request failed:', err);
            clearInterval(this.scrollRestoreTimer);
        }
    }

    setPopupToAnsweringState() {
        const state = this.selectionExplainState;
        // Clear previous content or hide snippet
        if (state.snippetEl) state.snippetEl.style.display = 'none';

        // Create or reuse answer container
        let answerEl = state.popup.querySelector('.timeline-explain-answer');
        if (!answerEl) {
            answerEl = document.createElement('div');
            answerEl.className = 'timeline-explain-answer markdown-body'; // Use markdown class if available
            answerEl.style.marginTop = '10px';
            answerEl.style.padding = '10px';
            answerEl.style.backgroundColor = '#f9f9f9';
            answerEl.style.borderRadius = '6px';
            answerEl.style.maxHeight = '300px';
            answerEl.style.overflowY = 'auto';
            answerEl.style.fontSize = '14px';
            answerEl.style.lineHeight = '1.5';
            // Insert before actions
            state.popup.insertBefore(answerEl, state.popup.lastElementChild);
        }
        answerEl.textContent = 'Thinking...';
        state.answerEl = answerEl;

        // Hide actions except Close
        if (state.sendButton) state.sendButton.style.display = 'none';
        if (state.cancelButton) state.cancelButton.textContent = 'Close';
    }

    updatePopupAnswer(text) {
        const state = this.selectionExplainState;
        if (state.answerEl) {
            state.answerEl.textContent = text;
            // Auto-scroll to bottom of answer
            state.answerEl.scrollTop = state.answerEl.scrollHeight;
        }
    }

    async monitorResponse(onUpdate) {
        // Wait for the new user turn to appear (it should be the last one)
        // Then wait for the assistant turn after it.

        // Actually, we just sent a message, so we expect a new assistant turn to appear at the bottom.
        // We need to find the *last* assistant turn.

        let assistantTurn = null;
        let retries = 0;

        while (!assistantTurn && retries < 50) {
            await new Promise(r => setTimeout(r, 200));
            const turns = document.querySelectorAll('article[data-turn-id]');
            if (turns.length > 0) {
                const last = turns[turns.length - 1];
                // Check if it's assistant
                const isUser = last.getAttribute('data-turn') === 'user' || last.querySelector('[data-message-author-role="user"]');
                if (!isUser) {
                    assistantTurn = last;
                }
            }
            retries++;
        }

        if (!assistantTurn) return;

        // Monitor its content
        let lastText = '';
        let stableCount = 0;

        while (true) {
            await new Promise(r => setTimeout(r, 100));
            const text = assistantTurn.innerText;

            if (text !== lastText) {
                lastText = text;
                onUpdate(text);
                stableCount = 0;
            } else {
                stableCount++;
            }

            // Check if generation is done (button changes from Stop to Regenerate/etc)
            // Or just timeout if stable for a long time
            if (stableCount > 20) break; // 2 seconds stable

            // Also check for "Stop generating" button disappearance
            const stopBtn = document.querySelector('button[aria-label="Stop generating"]');
            if (!stopBtn && stableCount > 5) break;
        }
    }

    async switchChatGPTModelIfNeeded(modelId) {
        if (modelId === 'default') return true;
        const model = this.selectionExplainModels.find(m => m.id === modelId);
        if (!model || !model.optionSelector) return true;
        const switcher = document.querySelector('[data-testid="model-switcher-button"], [data-testid="model-switcher"]');
        if (!switcher) return false;
        const label = (switcher.textContent || '').trim();
        if (model.labelPattern && model.labelPattern.test(label)) return true;
        switcher.click();
        const option = await this.waitForElement(model.optionSelector);
        if (!option) {
            try { switcher.click(); } catch { }
            return false;
        }
        option.click();
        await new Promise(resolve => setTimeout(resolve, 120));
        setTimeout(() => {
            try { document.body.click(); } catch { }
        }, 60);
        return true;
    }

    findComposerTextarea() {
        const selectors = [
            'form textarea#prompt-textarea',
            'form textarea[placeholder*="Message"]',
            'form textarea[placeholder*="Send"]',
            '[data-testid="conversation-composer"] textarea',
            '[data-testid="composer-textarea"]',
            'textarea[data-testid="conversation-composer-textarea"]',
            'textarea[data-id]',
            'textarea'
        ];
        for (let i = 0; i < selectors.length; i++) {
            const el = document.querySelector(selectors[i]);
            if (el && !el.disabled && el.offsetParent !== null) return el;
        }
        const editable = document.querySelector('[contenteditable="true"][data-testid="conversation-composer-textarea"], [contenteditable="true"][data-id="composer"]');
        return editable || null;
    }

    dispatchInput(el, value) {
        if (!el) return;
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
            el.value = value;
        } else {
            el.textContent = value;
        }
        const inputEvent = new Event('input', { bubbles: true, cancelable: true });
        el.dispatchEvent(inputEvent);
    }

    async sendExplainPrompt(text, modelId) {
        console.log('[ChatGPT Enhancer] sendExplainPrompt called');
        const target = this.findComposerTextarea();
        if (!target) {
            console.error('[ChatGPT Enhancer] Composer textarea not found');
            return false;
        }

        // Focus and set value
        target.focus();
        const prompt = `Please explain the highlighted portion from earlier in this conversation: \n\n${ text } \n\nFocus on the context directly above.`;

        console.log('[ChatGPT Enhancer] Setting value');
        // React often needs native value setter for state updates
        const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        nativeTextAreaValueSetter.call(target, prompt);

        // Dispatch events to trigger React state updates
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));

        // Wait a tick for state to settle
        await new Promise(r => setTimeout(r, 100));

        // Find send button
        console.log('[ChatGPT Enhancer] Looking for send button');
        const composer = target.closest('form') || document.querySelector('[data-testid="conversation-composer"]');
        let sendButton = null;
        if (composer) {
            sendButton = composer.querySelector('button[data-testid="send-button"]') ||
                composer.querySelector('button[aria-label="Send message"]') ||
                composer.querySelector('button[data-testid="composer-send-button"]');
        }

        // Fallback global search if composer context fails
        if (!sendButton) {
            sendButton = document.querySelector('button[data-testid="send-button"]') ||
                document.querySelector('button[aria-label="Send message"]');
        }

        if (sendButton && !sendButton.disabled) {
            console.log('[ChatGPT Enhancer] Clicking send button', sendButton);
            sendButton.click();
            return true;
        } else {
            console.warn('[ChatGPT Enhancer] Send button not found or disabled', sendButton);
        }

        // Fallback: Enter key
        console.log('[ChatGPT Enhancer] Trying Enter key fallback');
        const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
        target.dispatchEvent(enterDown);
        return true;
    }

    restoreConversationScroll(scrollTop, scrollLeft) {
        const target = this.scrollContainer;
        if (!target) return;
        const apply = () => {
            target.scrollTop = scrollTop;
            if (typeof scrollLeft === 'number') target.scrollLeft = scrollLeft;
        };
        apply();
        setTimeout(apply, 80);
        setTimeout(apply, 260);
        setTimeout(apply, 800);
    }

    setupObservers() {
        this.mutationObserver = new MutationObserver(() => {
            try { this.ensureContainersUpToDate(); } catch { }
            this.debouncedRecalculateAndRender();
            this.updateIntersectionObserverTargets();
        });
        this.mutationObserver.observe(this.conversationContainer, { childList: true, subtree: true });

        // Resize: update long-canvas geometry and virtualization
        this.resizeObserver = new ResizeObserver(() => {
            this.updateTimelineGeometry();
            this.syncTimelineTrackToMain();
            this.updateVirtualRangeAndRender();
        });
        if (this.ui.timelineBar) {
            this.resizeObserver.observe(this.ui.timelineBar);
        }

        this.intersectionObserver = new IntersectionObserver(entries => {
            // Maintain which user turns are currently visible
            entries.forEach(entry => {
                const target = entry.target;
                if (entry.isIntersecting) {
                    this.visibleUserTurns.add(target);
                } else {
                    this.visibleUserTurns.delete(target);
                }
            });

            // Defer active state decision to scroll-based computation
            this.scheduleScrollSync();
        }, {
            root: this.scrollContainer,
            threshold: 0.1,
            rootMargin: "-40% 0px -59% 0px"
        });

        this.updateIntersectionObserverTargets();

        // Observe theme toggles (e.g., html.dark) to refresh geometry immediately
        try {
            if (!this.themeObserver) {
                this.themeObserver = new MutationObserver(() => {
                    this.updateTimelineGeometry();
                    this.syncTimelineTrackToMain();
                    this.updateVirtualRangeAndRender();
                });
            }
            this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        } catch { }
    }

    setupAutoRename() {
        // Check if button already exists
        if (document.querySelector('.chatgpt-auto-rename-btn')) return;

        const headerSelector = '.sticky.top-0.z-10'; // Adjust selector based on ChatGPT DOM
        // Wait for header to appear if not present
        const header = document.querySelector(headerSelector);

        if (header) {
            this.injectRenameButton(header);
        } else {
            // Retry or observe
            setTimeout(() => {
                const h = document.querySelector(headerSelector);
                if (h) this.injectRenameButton(h);
            }, 2000);
        }

        // Listen for summary update
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'update_title') {
                this.updateChatTitle(request.summary);
            }
        });
    }

    injectRenameButton(header) {
        if (document.querySelector('.chatgpt-auto-rename-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'chatgpt-auto-rename-btn btn relative btn-neutral btn-small flex h-9 w-9 items-center justify-center rounded-lg border';
        btn.innerHTML = '<span>🖊️</span>'; // Icon
        btn.title = 'Auto Rename Chat';
        btn.style.position = 'absolute';
        btn.style.right = '60px'; // Adjust position
        btn.style.top = '10px';
        btn.style.zIndex = '100';

        btn.addEventListener('click', () => this.triggerAutoRename());

        header.appendChild(btn);
    }

    triggerAutoRename() {
        // Scrape chat content
        const turns = Array.from(document.querySelectorAll('article[data-turn-id]'));
        const textContent = turns.map(t => t.innerText).join('\n\n');

        if (!textContent) {
            alert('No content to summarize!');
            return;
        }

        // Send to background
        chrome.runtime.sendMessage({
            action: 'create_chat_and_summarize',
            content: textContent
        });
    }

    updateChatTitle(newTitle) {
        // This is tricky as ChatGPT uses React internal state.
        // We might need to simulate clicks or find the title input.
        // For now, let's try to find the title element and click "Rename" if possible,
        // or just alert the user with the new title.

        console.log('New Title Suggested:', newTitle);
        alert(`Suggested Title: ${ newTitle } \n\n(Copy this and rename manually for now, as direct DOM manipulation of React state is unstable)`);

        // TODO: Implement robust renaming if possible
    }

    setupFolders() {
        // Inject Folder UI into sidebar
        // This requires finding the sidebar nav
        const nav = document.querySelector('nav');
        if (!nav) {
            setTimeout(() => this.setupFolders(), 1000);
            return;
        }

        // Create Folder Container
        if (document.getElementById('chatgpt-folder-container')) return;

        const container = document.createElement('div');
        container.id = 'chatgpt-folder-container';
        container.className = 'px-2 py-2';

        // Add "New Folder" button
        const addBtn = document.createElement('button');
        addBtn.textContent = '+ New Folder';
        addBtn.className = 'text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 mb-2 w-full text-left px-2';
        addBtn.addEventListener('click', () => {
            const name = prompt('Folder Name:');
            if (name) {
                this.folderManager.createFolder(name);
                this.renderFolders();
            }
        });
        container.appendChild(addBtn);

        // Folder List
        const list = document.createElement('div');
        list.id = 'chatgpt-folder-list';
        container.appendChild(list);

        // Insert before the chat history list (usually the second child of nav or similar)
        // We need to be careful not to break existing layout.
        // Let's try inserting at the top of nav for now.
        nav.insertBefore(container, nav.firstChild);

        this.renderFolders();
        // Subscribe to changes
        this.folderManager.subscribe(() => this.renderFolders());
    }

    setupPrompts() {
        // Inject Prompt Button into Composer
        // We need to find the composer area
        const composer = document.querySelector('form') || document.querySelector('[data-testid="conversation-composer"]');
        if (!composer) {
            setTimeout(() => this.setupPrompts(), 1000);
            return;
        }

        if (document.getElementById('chatgpt-prompt-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'chatgpt-prompt-btn';
        btn.type = 'button';
        btn.className = 'absolute bottom-2 right-12 p-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700';
        btn.innerHTML = '<span>⚡</span>'; // Bolt icon
        btn.title = 'Prompt Toolbox';
        btn.style.zIndex = '20';

        // Position relative to composer
        // Actually, let's float it near the input
        const textarea = this.findComposerTextarea();
        if (textarea) {
            textarea.parentElement.appendChild(btn);
        } else {
            composer.appendChild(btn);
        }

        btn.addEventListener('click', () => this.togglePromptModal());
    }

    togglePromptModal() {
        let modal = document.getElementById('chatgpt-prompt-modal');
        if (modal) {
            modal.remove();
            return;
        }

        modal = document.createElement('div');
        modal.id = 'chatgpt-prompt-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50';

        const content = document.createElement('div');
        content.className = 'bg-white dark:bg-gray-800 rounded-lg shadow-xl w-96 max-h-[80vh] flex flex-col p-4';
        modal.appendChild(content);

        // Header
        const header = document.createElement('div');
        header.className = 'flex justify-between items-center mb-4';
        header.innerHTML = '<h3 class="text-lg font-bold">Prompt Toolbox</h3>';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.onclick = () => modal.remove();
        header.appendChild(closeBtn);
        content.appendChild(header);

        // List
        const list = document.createElement('div');
        list.className = 'flex-1 overflow-y-auto mb-4 space-y-2';
        this.promptManager.prompts.forEach(p => {
            const item = document.createElement('div');
            item.className = 'p-2 border rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer';
            item.innerHTML = `<div class="font-bold" > ${ p.title }</div> <div class="text-xs text-gray-500 truncate">${p.content}</div>`;
            item.onclick = () => {
                this.insertPrompt(p.content);
                modal.remove();
            };
            list.appendChild(item);
        });
        content.appendChild(list);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'flex gap-2';

        const importBtn = document.createElement('button');
        importBtn.textContent = 'Import';
        importBtn.className = 'btn btn-neutral btn-small';
        importBtn.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = (e) => {
                const file = e.target.files[0];
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.promptManager.importPrompts(ev.target.result);
                    modal.remove();
                    this.togglePromptModal(); // Re-open to refresh
                };
                reader.readAsText(file);
            };
            input.click();
        };
        actions.appendChild(importBtn);

        const exportBtn = document.createElement('button');
        exportBtn.textContent = 'Export';
        exportBtn.className = 'btn btn-neutral btn-small';
        exportBtn.onclick = () => this.promptManager.exportPrompts();
        actions.appendChild(exportBtn);

        content.appendChild(actions);
        document.body.appendChild(modal);
    }

    insertPrompt(text) {
        const textarea = this.findComposerTextarea();
        if (textarea) {
            this.dispatchInput(textarea, text);
            textarea.focus();
        }
    }

    // Ensure our conversation/scroll containers are still current after DOM replacements
    ensureContainersUpToDate() {
        const first = document.querySelector('article[data-turn-id]');
        if (!first) return;
        const newConv = first.parentElement;
        if (newConv && newConv !== this.conversationContainer) {
            // Rebind observers and listeners to the new conversation root
            this.rebindConversationContainer(newConv);
        }
    }

    rebindConversationContainer(newConv) {
        // Detach old listeners
        if (this.scrollContainer && this.onScroll) {
            try { this.scrollContainer.removeEventListener('scroll', this.onScroll); } catch { }
        }
        if (this.scrollContainer && this.selectionExplainHandlers.onScroll) {
            try { this.scrollContainer.removeEventListener('scroll', this.selectionExplainHandlers.onScroll); } catch { }
        }
        try { this.mutationObserver?.disconnect(); } catch { }
        try { this.intersectionObserver?.disconnect(); } catch { }
        try { this.themeObserver?.disconnect(); } catch { }

        this.conversationContainer = newConv;
        try {
            this.hideSelectionExplainPopup();
            this.hideSelectionExplainButton(true);
            this.selectionExplainState.selectedText = '';
            this.selectionExplainState.articleElement = null;
            this.selectionExplainState.turnId = null;
        } catch { }

        // Find (or re-find) scroll container
        let parent = newConv;
        let newScroll = null;
        while (parent && parent !== document.body) {
            const style=window.getComputedStyle(parent);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                newScroll = parent; break;
            }
            parent = parent.parentElement;
        }
        if (!newScroll) newScroll = document.scrollingElement || document.documentElement || document.body;
        this.scrollContainer = newScroll;
        // Reattach scroll listener
        this.onScroll = () => this.scheduleScrollSync();
        this.scrollContainer.addEventListener('scroll', this.onScroll, { passive: true });
        if (this.selectionExplainHandlers.onScroll) {
            this.scrollContainer.addEventListener('scroll', this.selectionExplainHandlers.onScroll, { passive: true });
        }

        // Recreate IntersectionObserver with new root
        this.intersectionObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                const target = entry.target;
                if (entry.isIntersecting) { this.visibleUserTurns.add(target); }
                else { this.visibleUserTurns.delete(target); }
            });
            this.scheduleScrollSync();
        }, { root: this.scrollContainer, threshold: 0.1, rootMargin: "-40% 0px -59% 0px" });
        this.updateIntersectionObserverTargets();

        // Re-observe mutations on the new conversation container
        this.mutationObserver.observe(this.conversationContainer, { childList: true, subtree: true });

        // Force a recalc right away to rebuild markers
        this.recalculateAndRenderMarkers();
    }

    updateIntersectionObserverTargets() {
        if (!this.intersectionObserver || !this.conversationContainer) return;
        this.intersectionObserver.disconnect();
        this.visibleUserTurns.clear();
        const userTurns = this.conversationContainer.querySelectorAll('article[data-turn="user"][data-turn-id]');
        userTurns.forEach(el => this.intersectionObserver.observe(el));
    }

    setupEventListeners() {
        this.onTimelineBarClick = (e) => {
            const dot = e.target.closest('.timeline-dot');
            if (dot) {
                const now = Date.now();
                if (now < (this.suppressClickUntil || 0)) {
                    try { e.preventDefault(); e.stopPropagation(); } catch { }
                    return;
                }
                const targetId = dot.dataset.targetTurnId;
                const targetElement = this.conversationContainer.querySelector(`article[data - turn - id= "${targetId}"]`);
                if (targetElement) {
                    // Only scroll; let scroll-based computation set active to avoid double-flash
                    this.smoothScrollTo(targetElement);
                }
            }
        };
        this.ui.timelineBar.addEventListener('click', this.onTimelineBarClick);
        // Long-press gesture on dots (delegated on bar)
        this.onPointerDown = (ev) => {
            const dot = ev.target.closest?.('.timeline-dot');
            if (!dot) return;
            if (typeof ev.button === 'number' && ev.button !== 0) return; // left button only
            this.cancelLongPress();
            this.pressTargetDot = dot;
            this.pressStartPos = { x: ev.clientX, y: ev.clientY };
            try { dot.classList.add('holding'); } catch { }
            this.longPressTriggered = false;
            this.longPressTimer = setTimeout(() => {
                this.longPressTimer = null;
                if (!this.pressTargetDot) return;
                const id = this.pressTargetDot.dataset.targetTurnId;
                this.toggleStar(id);
                this.longPressTriggered = true;
                this.suppressClickUntil = Date.now() + 350;
                // If tooltip is visible for this dot, refresh immediately to reflect ★ prefix change
                try { this.refreshTooltipForDot(this.pressTargetDot); } catch { }
                try { this.pressTargetDot.classList.remove('holding'); } catch { }
            }, this.longPressDuration);
        };
        this.onPointerMove = (ev) => {
            if (!this.pressTargetDot || !this.pressStartPos) return;
            const dx = ev.clientX - this.pressStartPos.x;
            const dy = ev.clientY - this.pressStartPos.y;
            if ((dx * dx + dy * dy) > (this.longPressMoveTolerance * this.longPressMoveTolerance)) {
                this.cancelLongPress();
            }
        };
        this.onPointerUp = () => { this.cancelLongPress(); };
        this.onPointerCancel = () => { this.cancelLongPress(); };
        this.onPointerLeave = (ev) => {
            const dot = ev.target.closest?.('.timeline-dot');
            if (dot && dot === this.pressTargetDot) this.cancelLongPress();
        };
        try {
            this.ui.timelineBar.addEventListener('pointerdown', this.onPointerDown);
            window.addEventListener('pointermove', this.onPointerMove, { passive: true });
            window.addEventListener('pointerup', this.onPointerUp, { passive: true });
            window.addEventListener('pointercancel', this.onPointerCancel, { passive: true });
            this.ui.timelineBar.addEventListener('pointerleave', this.onPointerLeave);
        } catch { }
        // Listen to container scroll to keep marker active state in sync
        this.onScroll = () => this.scheduleScrollSync();
        this.scrollContainer.addEventListener('scroll', this.onScroll, { passive: true });

        // Tooltip interactions (delegated)
        this.onTimelineBarOver = (e) => {
            const dot = e.target.closest('.timeline-dot');
            if (dot) this.showTooltipForDot(dot);
        };
        this.onTimelineBarOut = (e) => {
            const fromDot = e.target.closest('.timeline-dot');
            const toDot = e.relatedTarget?.closest?.('.timeline-dot');
            if (fromDot && !toDot) this.hideTooltip();
        };
        this.onTimelineBarFocusIn = (e) => {
            const dot = e.target.closest('.timeline-dot');
            if (dot) this.showTooltipForDot(dot);
        };
        this.onTimelineBarFocusOut = (e) => {
            const dot = e.target.closest('.timeline-dot');
            if (dot) this.hideTooltip();
        };
        this.ui.timelineBar.addEventListener('mouseover', this.onTimelineBarOver);
        this.ui.timelineBar.addEventListener('mouseout', this.onTimelineBarOut);
        this.ui.timelineBar.addEventListener('focusin', this.onTimelineBarFocusIn);
        this.ui.timelineBar.addEventListener('focusout', this.onTimelineBarFocusOut);

        // Slider visibility on hover (time axis or slider itself) with stable refs
        // Define and persist handlers so we can remove them in destroy()
        this.onBarEnter = () => this.showSlider();
        this.onBarLeave = () => this.hideSliderDeferred();
        this.onSliderEnter = () => this.showSlider();
        this.onSliderLeave = () => this.hideSliderDeferred();
        try {
            this.ui.timelineBar.addEventListener('pointerenter', this.onBarEnter);
            this.ui.timelineBar.addEventListener('pointerleave', this.onBarLeave);
            if (this.ui.slider) {
                this.ui.slider.addEventListener('pointerenter', this.onSliderEnter);
                this.ui.slider.addEventListener('pointerleave', this.onSliderLeave);
            }
        } catch { }

        // Reposition tooltip on resize
        this.onWindowResize = () => {
            if (this.ui.tooltip?.classList.contains('visible')) {
                const activeDot = this.ui.timelineBar.querySelector('.timeline-dot:hover, .timeline-dot:focus');
                if (activeDot) {
                    // Re-run T0->T1 to avoid layout during animation
                    const tip = this.ui.tooltip;
                    tip.classList.remove('visible');
                    let fullText = (activeDot.getAttribute('aria-label') || '').trim();
                    try {
                        const id = activeDot.dataset.targetTurnId;
                        if (id && this.starred.has(id)) fullText = `★ ${ fullText } `;
                    } catch { }
                    const p = this.computePlacementInfo(activeDot);
                    const layout = this.truncateToThreeLines(fullText, p.width, true);
                    tip.textContent = layout.text;
                    this.placeTooltipAt(activeDot, p.placement, p.width, layout.height);
                    if (this.showRafId !== null) {
                        try { cancelAnimationFrame(this.showRafId); } catch { }
                        this.showRafId = null;
                    }
                    this.showRafId = requestAnimationFrame(() => {
                        this.showRafId = null;
                        tip.classList.add('visible');
                    });
                }
            }
            // Update long-canvas geometry and virtualization
            this.updateTimelineGeometry();
            this.syncTimelineTrackToMain();
            this.updateVirtualRangeAndRender();
        };
        window.addEventListener('resize', this.onWindowResize);
        // VisualViewport resize can fire on zoom on some platforms; schedule correction
        if (window.visualViewport) {
            this.onVisualViewportResize = () => {
                this.updateTimelineGeometry();
                this.syncTimelineTrackToMain();
                this.updateVirtualRangeAndRender();
            };
            try { window.visualViewport.addEventListener('resize', this.onVisualViewportResize); } catch { }
        }

        // Scroll wheel on the timeline controls the main scroll container (Linked mode)
        this.onTimelineWheel = (e) => {
            // Prevent page from attempting to scroll anything else
            try { e.preventDefault(); } catch { }
            const delta = e.deltaY || 0;
            this.scrollContainer.scrollTop += delta;
            // Keep markers in sync on next frame
            this.scheduleScrollSync();
            this.showSlider();
        };
        this.ui.timelineBar.addEventListener('wheel', this.onTimelineWheel, { passive: false });

        // Slider drag handlers
        this.onSliderDown = (ev) => {
            if (!this.ui.sliderHandle) return;
            try { this.ui.sliderHandle.setPointerCapture(ev.pointerId); } catch { }
            this.sliderDragging = true;
            this.showSlider();
            this.sliderStartClientY = ev.clientY;
            const rect = this.ui.sliderHandle.getBoundingClientRect();
            this.sliderStartTop = rect.top;
            this.onSliderMove = (e) => this.handleSliderDrag(e);
            this.onSliderUp = (e) => this.endSliderDrag(e);
            window.addEventListener('pointermove', this.onSliderMove);
            window.addEventListener('pointerup', this.onSliderUp, { once: true });
        };
        try { this.ui.sliderHandle?.addEventListener('pointerdown', this.onSliderDown); } catch { }

        // Cross-tab star sync via localStorage 'storage' event
        this.onStorage = (e) => {
            try {
                if (!e || e.storageArea !== localStorage) return;
                const cid = this.conversationId;
                if (!cid) return;
                const expectedKey = `chatgptTimelineStars:${ cid } `;
                if (e.key !== expectedKey) return;

                // Parse new star set
                let nextArr = [];
                try { nextArr = JSON.parse(e.newValue || '[]') || []; } catch { nextArr = []; }
                const nextSet = new Set(nextArr.map(x => String(x)));

                // Fast no-op check: if sizes match and all entries exist, skip
                if (nextSet.size === this.starred.size) {
                    let same = true;
                    for (const id of this.starred) { if (!nextSet.has(id)) { same = false; break; } }
                    if (same) return;
                }

                // Apply to in-memory set
                this.starred = nextSet;

                // Update markers and any visible dots
                for (let i = 0; i < this.markers.length; i++) {
                    const m = this.markers[i];
                    const want = this.starred.has(m.id);
                    if (m.starred !== want) {
                        m.starred = want;
                        if (m.dotElement) {
                            try {
                                m.dotElement.classList.toggle('starred', m.starred);
                                m.dotElement.setAttribute('aria-pressed', m.starred ? 'true' : 'false');
                            } catch { }
                        }
                    }
                }

                // If a tooltip is currently visible over any dot, refresh it to reflect ★
                try {
                    if (this.ui.tooltip?.classList.contains('visible')) {
                        const currentDot = this.ui.timelineBar.querySelector('.timeline-dot:hover, .timeline-dot:focus');
                        if (currentDot) this.refreshTooltipForDot(currentDot);
                    }
                } catch { }
            } catch { }
        };
        try { window.addEventListener('storage', this.onStorage); } catch { }
    }

    smoothScrollTo(targetElement, duration = 600) {
        const containerRect = this.scrollContainer.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();
        const targetPosition = targetRect.top - containerRect.top + this.scrollContainer.scrollTop;
        const startPosition = this.scrollContainer.scrollTop;
        const distance = targetPosition - startPosition;
        let startTime = null;

        const animation = (currentTime) => {
            this.isScrolling = true;
            if (startTime === null) startTime = currentTime;
            const timeElapsed = currentTime - startTime;
            const run = this.easeInOutQuad(timeElapsed, startPosition, distance, duration);
            this.scrollContainer.scrollTop = run;
            if (timeElapsed < duration) {
                requestAnimationFrame(animation);
            } else {
                this.scrollContainer.scrollTop = targetPosition;
                this.isScrolling = false;
            }
        };
        requestAnimationFrame(animation);
    }

    easeInOutQuad(t, b, c, d) {
        t /= d / 2;
        if (t < 1) return c / 2 * t * t + b;
        t--;
        return -c / 2 * (t * (t - 2) - 1) + b;
    }

    updateActiveDotUI() {
        this.markers.forEach(marker => {
            marker.dotElement?.classList.toggle('active', marker.id === this.activeTurnId);
        });
    }

    debounce(func, delay) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    // Read numeric CSS var from the timeline bar element
    getCSSVarNumber(el, name, fallback) {
        const v = getComputedStyle(el).getPropertyValue(name).trim();
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : fallback;
    }

    // Normalize whitespace and trim; remove leading SR-only prefixes like "You said:" / "你说："; no manual ellipsis
    normalizeText(text) {
        try {
            let s = String(text || '').replace(/\s+/g, ' ').trim();
            // Strip only if it appears at the very start
            s = s.replace(/^\s*(you\s*said\s*[:：]?\s*)/i, '');
            s = s.replace(/^\s*((你说|您说|你說|您說)\s*[:：]?\s*)/, '');
            return s;
        } catch {
            return '';
        }
    }

    getTrackPadding() {
        if (!this.ui.timelineBar) return 12;
        return this.getCSSVarNumber(this.ui.timelineBar, '--timeline-track-padding', 12);
    }

    getMinGap() {
        if (!this.ui.timelineBar) return 12;
        return this.getCSSVarNumber(this.ui.timelineBar, '--timeline-min-gap', 12);
    }

    // Enforce a minimum pixel gap between positions while staying within bounds
    applyMinGap(positions, minTop, maxTop, gap) {
        const n = positions.length;
        if (n === 0) return positions;
        const out = positions.slice();
        // Clamp first and forward pass (monotonic increasing)
        out[0] = Math.max(minTop, Math.min(positions[0], maxTop));
        for (let i = 1; i < n; i++) {
            const minAllowed = out[i - 1] + gap;
            out[i] = Math.max(positions[i], minAllowed);
        }
        // If last exceeds max, backward pass
        if (out[n - 1] > maxTop) {
            out[n - 1] = maxTop;
            for (let i = n - 2; i >= 0; i--) {
                const maxAllowed = out[i + 1] - gap;
                out[i] = Math.min(out[i], maxAllowed);
            }
            // Ensure first still within min
            if (out[0] < minTop) {
                out[0] = minTop;
                for (let i = 1; i < n; i++) {
                    const minAllowed = out[i - 1] + gap;
                    out[i] = Math.max(out[i], minAllowed);
                }
            }
        }
        // Final clamp
        for (let i = 0; i < n; i++) {
            if (out[i] < minTop) out[i] = minTop;
            if (out[i] > maxTop) out[i] = maxTop;
        }
        return out;
    }

    // (Removed) Idle min-gap reapply; ChatGPT keeps min-gap solely in updateTimelineGeometry

    showTooltipForDot(dot) {
        if (!this.ui.tooltip) return;
        try { if (this.tooltipHideTimer) { clearTimeout(this.tooltipHideTimer); this.tooltipHideTimer = null; } } catch { }
        // T0: compute + write geometry while hidden
        const tip = this.ui.tooltip;
        tip.classList.remove('visible');
        let fullText = (dot.getAttribute('aria-label') || '').trim();
        try {
            const id = dot.dataset.targetTurnId;
            if (id && this.starred.has(id)) {
                fullText = `★ ${ fullText } `;
            }
        } catch { }
        const p = this.computePlacementInfo(dot);
        const layout = this.truncateToThreeLines(fullText, p.width, true);
        tip.textContent = layout.text;
        this.placeTooltipAt(dot, p.placement, p.width, layout.height);
        tip.setAttribute('aria-hidden', 'false');
        // T1: next frame add visible for non-geometric animation only
        if (this.showRafId !== null) {
            try { cancelAnimationFrame(this.showRafId); } catch { }
            this.showRafId = null;
        }
        this.showRafId = requestAnimationFrame(() => {
            this.showRafId = null;
            tip.classList.add('visible');
        });
    }

    hideTooltip(immediate = false) {
        if (!this.ui.tooltip) return;
        const doHide = () => {
            this.ui.tooltip.classList.remove('visible');
            this.ui.tooltip.setAttribute('aria-hidden', 'true');
            this.tooltipHideTimer = null;
        };
        if (immediate) return doHide();
        try { if (this.tooltipHideTimer) { clearTimeout(this.tooltipHideTimer); } } catch { }
        this.tooltipHideTimer = setTimeout(doHide, this.tooltipHideDelay);
    }

    placeTooltipAt(dot, placement, width, height) {
        if (!this.ui.tooltip) return;
        const tip = this.ui.tooltip;
        const dotRect = dot.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const arrowOut = this.getCSSVarNumber(tip, '--timeline-tooltip-arrow-outside', 6);
        const baseGap = this.getCSSVarNumber(tip, '--timeline-tooltip-gap-visual', 12);
        const boxGap = this.getCSSVarNumber(tip, '--timeline-tooltip-gap-box', 8);
        const gap = baseGap + Math.max(0, arrowOut) + Math.max(0, boxGap);
        const viewportPad = 8;

        let left;
        if (placement === 'left') {
            left = Math.round(dotRect.left - gap - width);
            if (left < viewportPad) {
                // Clamp within viewport: switch to right if impossible
                const altLeft = Math.round(dotRect.right + gap);
                if (altLeft + width <= vw - viewportPad) {
                    placement = 'right';
                    left = altLeft;
                } else {
                    // shrink width to fit
                    const fitWidth = Math.max(120, vw - viewportPad - altLeft);
                    left = altLeft;
                    width=fitWidth;
                }
            }
        } else {
            left = Math.round(dotRect.right + gap);
            if (left + width > vw - viewportPad) {
                const altLeft = Math.round(dotRect.left - gap - width);
                if (altLeft >= viewportPad) {
                    placement = 'left';
                    left = altLeft;
                } else {
                    const fitWidth = Math.max(120, vw - viewportPad - left);
                    width=fitWidth;
                }
            }
        }

        let top = Math.round(dotRect.top + dotRect.height / 2 - height / 2);
        top = Math.max(viewportPad, Math.min(vh - height - viewportPad, top));
        tip.style.width=`${ Math.floor(width) } px`;
        tip.style.height=`${ Math.floor(height) } px`;
        tip.style.left = `${ left } px`;
        tip.style.top = `${ top } px`;
        tip.setAttribute('data-placement', placement);
    }

    // Refresh the currently visible tooltip for a given dot in place (no hide/show flicker)
    refreshTooltipForDot(dot) {
        if (!this.ui?.tooltip || !dot) return;
        const tip = this.ui.tooltip;
        // Only update when tooltip is currently visible
        const isVisible = tip.classList.contains('visible');
        if (!isVisible) return;

        let fullText = (dot.getAttribute('aria-label') || '').trim();
        try {
            const id = dot.dataset.targetTurnId;
            if (id && this.starred.has(id)) fullText = `★ ${ fullText } `;
        } catch { }
        const p = this.computePlacementInfo(dot);
        const layout = this.truncateToThreeLines(fullText, p.width, true);
        tip.textContent = layout.text;
        this.placeTooltipAt(dot, p.placement, p.width, layout.height);
    }

    // --- Long-canvas geometry and virtualization (Linked mode) ---
    updateTimelineGeometry() {
        if (!this.ui.timelineBar || !this.ui.trackContent) return;
        const H = this.ui.timelineBar.clientHeight || 0;
        const pad = this.getTrackPadding();
        const minGap = this.getMinGap();
        const N = this.markers.length;
        // Content height ensures minGap between consecutive dots
        const desired = Math.max(H, (N > 0 ? (2 * pad + Math.max(0, N - 1) * minGap) : H));
        this.contentHeight = Math.ceil(desired);
        this.scale = (H > 0) ? (this.contentHeight / H) : 1;
        try { this.ui.trackContent.style.height=`${ this.contentHeight } px`; } catch { }

        // Precompute desired Y from normalized baseN and enforce min-gap
        const usableC = Math.max(1, this.contentHeight - 2 * pad);
        const desiredY = this.markers.map(m => pad + Math.max(0, Math.min(1, (m.baseN ?? m.n ?? 0))) * usableC);
        const adjusted = this.applyMinGap(desiredY, pad, pad + usableC, minGap);
        this.yPositions = adjusted;
        // Update normalized n for CSS positioning
        for (let i = 0; i < N; i++) {
            const top = adjusted[i];
            const n = (top - pad) / usableC;
            this.markers[i].n = Math.max(0, Math.min(1, n));
            if (this.markers[i].dotElement && !this.usePixelTop) {
                try { this.markers[i].dotElement.style.setProperty('--n', String(this.markers[i].n)); } catch { }
            }
        }
        if (this._cssVarTopSupported === null) {
            this._cssVarTopSupported = this.detectCssVarTopSupport(pad, usableC);
            this.usePixelTop = !this._cssVarTopSupported;
        }
        this.updateSlider();
        // First-time nudge: if content is scrollable, briefly reveal slider
        const barH = this.ui.timelineBar?.clientHeight || 0;
        if (this.contentHeight > barH + 1) {
            this.sliderAlwaysVisible = true;
            this.showSlider();
        } else {
            this.sliderAlwaysVisible = false;
        }
    }

    detectCssVarTopSupport(pad, usableC) {
        try {
            if (!this.ui.trackContent) return false;
            const test = document.createElement('button');
            test.className = 'timeline-dot';
            test.style.visibility = 'hidden';
            test.style.pointerEvents = 'none';
            test.setAttribute('aria-hidden', 'true');
            const expected = pad + 0.5 * usableC;
            test.style.setProperty('--n', '0.5');
            this.ui.trackContent.appendChild(test);
            const cs = getComputedStyle(test);
            const topStr = cs.top || '';
            const px = parseFloat(topStr);
            test.remove();
            if (!Number.isFinite(px)) return false;
            return Math.abs(px - expected) <= 2;
        } catch {
            return false;
        }
    }

    syncTimelineTrackToMain() {
        if (this.sliderDragging) return; // do not override when user drags slider
        if (!this.ui.track || !this.scrollContainer || !this.contentHeight) return;
        const scrollTop = this.scrollContainer.scrollTop;
        const ref = scrollTop + this.scrollContainer.clientHeight * 0.45;
        const span = Math.max(1, this.contentSpanPx || 1);
        const r = Math.max(0, Math.min(1, (ref - (this.firstUserTurnOffset || 0)) / span));
        const maxScroll = Math.max(0, this.contentHeight - (this.ui.track.clientHeight || 0));
        const target = Math.round(r * maxScroll);
        if (Math.abs((this.ui.track.scrollTop || 0) - target) > 1) {
            this.ui.track.scrollTop = target;
        }
    }

    updateVirtualRangeAndRender() {
        const localVersion = this.markersVersion;
        if (!this.ui.track || !this.ui.trackContent || this.markers.length === 0) return;
        const st = this.ui.track.scrollTop || 0;
        const vh = this.ui.track.clientHeight || 0;
        const buffer = Math.max(100, vh);
        const minY = st - buffer;
        const maxY = st + vh + buffer;
        const start = this.lowerBound(this.yPositions, minY);
        const end = Math.max(start - 1, this.upperBound(this.yPositions, maxY));

        let prevStart = this.visibleRange.start;
        let prevEnd = this.visibleRange.end;
        const len = this.markers.length;
        // Clamp previous indices into current bounds to avoid undefined access
        if (len > 0) {
            prevStart = Math.max(0, Math.min(prevStart, len - 1));
            prevEnd = Math.max(-1, Math.min(prevEnd, len - 1));
        }
        if (prevEnd >= prevStart) {
            for (let i = prevStart; i < Math.min(start, prevEnd + 1); i++) {
                const m = this.markers[i];
                if (m && m.dotElement) { try { m.dotElement.remove(); } catch { } m.dotElement = null; }
            }
            for (let i = Math.max(end + 1, prevStart); i <= prevEnd; i++) {
                const m = this.markers[i];
                if (m && m.dotElement) { try { m.dotElement.remove(); } catch { } m.dotElement = null; }
            }
        } else {
            (this.ui.trackContent || this.ui.timelineBar).querySelectorAll('.timeline-dot').forEach(n => n.remove());
            this.markers.forEach(m => { m.dotElement = null; });
        }

        const frag = document.createDocumentFragment();
        for (let i = start; i <= end; i++) {
            const marker = this.markers[i];
            if (!marker) continue;
            if (!marker.dotElement) {
                const dot = document.createElement('button');
                dot.className = 'timeline-dot';
                dot.dataset.targetTurnId = marker.id;
                dot.setAttribute('aria-label', marker.summary);
                dot.setAttribute('tabindex', '0');
                try { dot.setAttribute('aria-describedby', 'chatgpt-timeline-tooltip'); } catch { }
                try { dot.style.setProperty('--n', String(marker.n || 0)); } catch { }
                if (this.usePixelTop) {
                    dot.style.top = `${ Math.round(this.yPositions[i]) } px`;
                }
                // Apply active state immediately if this is the active marker
                try { dot.classList.toggle('active', marker.id === this.activeTurnId); } catch { }
                // Apply starred state and aria
                try {
                    dot.classList.toggle('starred', !!marker.starred);
                    dot.setAttribute('aria-pressed', marker.starred ? 'true' : 'false');
                } catch { }
                marker.dotElement = dot;
                frag.appendChild(dot);
            } else {
                try { marker.dotElement.style.setProperty('--n', String(marker.n || 0)); } catch { }
                if (this.usePixelTop) {
                    marker.dotElement.style.top = `${ Math.round(this.yPositions[i]) } px`;
                }
                try {
                    marker.dotElement.classList.toggle('starred', !!marker.starred);
                    marker.dotElement.setAttribute('aria-pressed', marker.starred ? 'true' : 'false');
                } catch { }
            }
        }
        if (localVersion !== this.markersVersion) return; // stale pass, abort
        if (frag.childNodes.length) this.ui.trackContent.appendChild(frag);
        this.visibleRange = { start, end };
        // keep slider in sync with timeline scroll
        this.updateSlider();
    }

    lowerBound(arr, x) {
        let lo = 0, hi = arr.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] < x) lo = mid + 1; else hi = mid;
        }
        return lo;
    }

    upperBound(arr, x) {
        let lo = 0, hi = arr.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] <= x) lo = mid + 1; else hi = mid;
        }
        return lo - 1;
    }

    // --- Left slider helpers ---
    updateSlider() {
        if (!this.ui.slider || !this.ui.sliderHandle) return;
        if (!this.contentHeight || !this.ui.timelineBar || !this.ui.track) return;
        const barRect = this.ui.timelineBar.getBoundingClientRect();
        const barH = barRect.height || 0;
        const pad = this.getTrackPadding();
        const innerH = Math.max(0, barH - 2 * pad);
        if (this.contentHeight <= barH + 1 || innerH <= 0) {
            this.sliderAlwaysVisible = false;
            try {
                this.ui.slider.classList.remove('visible');
                this.ui.slider.style.opacity = '';
            } catch { }
            return;
        }
        this.sliderAlwaysVisible = true;
        // External slider geometry (short rail centered on inner area)
        const railLen = Math.max(120, Math.min(240, Math.floor(barH * 0.45)));
        const railTop = Math.round(barRect.top + pad + (innerH - railLen) / 2);
        const railLeftGap = 8; // px gap from bar's left edge
        const sliderWidth = 12; // matches CSS
        const left = Math.round(barRect.left - railLeftGap - sliderWidth);
        this.ui.slider.style.left = `${ left } px`;
        this.ui.slider.style.top = `${ railTop } px`;
        this.ui.slider.style.height=`${ railLen } px`;

        const handleH = 22; // fixed concise handle
        const maxTop = Math.max(0, railLen - handleH);
        const range = Math.max(1, this.contentHeight - barH);
        const st = this.ui.track.scrollTop || 0;
        const r = Math.max(0, Math.min(1, st / range));
        const top = Math.round(r * maxTop);
        this.ui.sliderHandle.style.height=`${ handleH } px`;
        this.ui.sliderHandle.style.top = `${ top } px`;
        try {
            this.ui.slider.classList.add('visible');
            this.ui.slider.style.opacity = '';
        } catch { }
    }

    showSlider() {
        if (!this.ui.slider) return;
        this.ui.slider.classList.add('visible');
        if (this.sliderFadeTimer) { try { clearTimeout(this.sliderFadeTimer); } catch { } this.sliderFadeTimer = null; }
        this.updateSlider();
    }

    hideSliderDeferred() {
        if (this.sliderDragging || this.sliderAlwaysVisible) return;
        if (this.sliderFadeTimer) { try { clearTimeout(this.sliderFadeTimer); } catch { } }
        this.sliderFadeTimer = setTimeout(() => {
            this.sliderFadeTimer = null;
            try { this.ui.slider?.classList.remove('visible'); } catch { }
        }, this.sliderFadeDelay);
    }

    handleSliderDrag(e) {
        if (!this.sliderDragging || !this.ui.timelineBar || !this.ui.track) return;
        const barRect = this.ui.timelineBar.getBoundingClientRect();
        const barH = barRect.height || 0;
        const railLen = parseFloat(this.ui.slider.style.height || '0') || Math.max(120, Math.min(240, Math.floor(barH * 0.45)));
        const handleH = this.ui.sliderHandle.getBoundingClientRect().height || 22;
        const maxTop = Math.max(0, railLen - handleH);
        const delta = e.clientY - this.sliderStartClientY;
        let top = Math.max(0, Math.min(maxTop, (this.sliderStartTop + delta) - (parseFloat(this.ui.slider.style.top) || 0)));
        const r = (maxTop > 0) ? (top / maxTop) : 0;
        const range = Math.max(1, this.contentHeight - barH);
        this.ui.track.scrollTop = Math.round(r * range);
        this.updateVirtualRangeAndRender();
        this.showSlider();
        this.updateSlider();
    }

    endSliderDrag(e) {
        this.sliderDragging = false;
        try { window.removeEventListener('pointermove', this.onSliderMove); } catch { }
        this.onSliderMove = null;
        this.onSliderUp = null;
        this.hideSliderDeferred();
    }

    computePlacementInfo(dot) {
        const tip = this.ui.tooltip || document.body;
        const dotRect = dot.getBoundingClientRect();
        const vw = window.innerWidth;
        const arrowOut = this.getCSSVarNumber(tip, '--timeline-tooltip-arrow-outside', 6);
        const baseGap = this.getCSSVarNumber(tip, '--timeline-tooltip-gap-visual', 12);
        const boxGap = this.getCSSVarNumber(tip, '--timeline-tooltip-gap-box', 8);
        const gap = baseGap + Math.max(0, arrowOut) + Math.max(0, boxGap);
        const viewportPad = 8;
        const maxW = this.getCSSVarNumber(tip, '--timeline-tooltip-max', 288);
        const minW = 160;
        const leftAvail = Math.max(0, dotRect.left - gap - viewportPad);
        const rightAvail = Math.max(0, vw - dotRect.right - gap - viewportPad);
        let placement = (rightAvail > leftAvail) ? 'right' : 'left';
        let avail = placement === 'right' ? rightAvail : leftAvail;
        // choose width tier for determinism
        const tiers = [280, 240, 200, 160];
        const hardMax = Math.max(minW, Math.min(maxW, Math.floor(avail)));
        let width=tiers.find(t => t <= hardMax) || Math.max(minW, Math.min(hardMax, 160));
        // if no tier fits (very tight), try switching side
        if (width < minW && placement === 'left' && rightAvail > leftAvail) {
            placement = 'right';
            avail = rightAvail;
            const hardMax2 = Math.max(minW, Math.min(maxW, Math.floor(avail)));
            width=tiers.find(t => t <= hardMax2) || Math.max(120, Math.min(hardMax2, minW));
        } else if (width < minW && placement === 'right' && leftAvail >= rightAvail) {
            placement = 'left';
            avail = leftAvail;
            const hardMax2 = Math.max(minW, Math.min(maxW, Math.floor(avail)));
            width=tiers.find(t => t <= hardMax2) || Math.max(120, Math.min(hardMax2, minW));
        }
        width=Math.max(120, Math.min(width, maxW));
        return { placement, width };
    }

    truncateToThreeLines(text, targetWidth, wantLayout = false) {
        try {
            if (!this.measureEl || !this.ui.tooltip) return wantLayout ? { text, height: 0 } : text;
            const tip = this.ui.tooltip;
            const lineH = this.getCSSVarNumber(tip, '--timeline-tooltip-lh', 18);
            const padY = this.getCSSVarNumber(tip, '--timeline-tooltip-pad-y', 10);
            const borderW = this.getCSSVarNumber(tip, '--timeline-tooltip-border-w', 1);
            const maxH = Math.round(3 * lineH + 2 * padY + 2 * borderW);
            const ell = '…';
            const el = this.measureEl;
            el.style.width=`${ Math.max(0, Math.floor(targetWidth)) } px`;

            // fast path: full text fits within 3 lines
            el.textContent = String(text || '').replace(/\s+/g, ' ').trim();
            let h = el.offsetHeight;
            if (h <= maxH) {
                return wantLayout ? { text: el.textContent, height: h } : el.textContent;
            }

            // binary search longest prefix that fits
            const raw = el.textContent;
            let lo = 0, hi = raw.length, ans = 0;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                el.textContent = raw.slice(0, mid).trimEnd() + ell;
                h = el.offsetHeight;
                if (h <= maxH) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
            }
            const out = (ans >= raw.length) ? raw : (raw.slice(0, ans).trimEnd() + ell);
            el.textContent = out;
            h = el.offsetHeight;
            return wantLayout ? { text: out, height: Math.min(h, maxH) } : out;
        } catch {
            return wantLayout ? { text, height: 0 } : text;
        }
    }

    scheduleScrollSync() {
        if (this.scrollRafId !== null) return;
        this.scrollRafId = requestAnimationFrame(() => {
            this.scrollRafId = null;
            // Sync long-canvas scroll and virtualized dots before computing active
            this.syncTimelineTrackToMain();
            this.updateVirtualRangeAndRender();
            this.computeActiveByScroll();
            this.updateSlider();
        });
    }

    computeActiveByScroll() {
        if (!this.scrollContainer || this.markers.length === 0) return;
        const containerRect = this.scrollContainer.getBoundingClientRect();
        const scrollTop = this.scrollContainer.scrollTop;
        const ref = scrollTop + this.scrollContainer.clientHeight * 0.45;

        let activeId = this.markers[0].id;
        for (let i = 0; i < this.markers.length; i++) {
            const m = this.markers[i];
            const top = m.element.getBoundingClientRect().top - containerRect.top + scrollTop;
            if (top <= ref) {
                activeId = m.id;
            } else {
                break;
            }
        }
        if (this.activeTurnId !== activeId) {
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const since = now - this.lastActiveChangeTime;
            if (since < this.minActiveChangeInterval) {
                // Coalesce rapid changes during fast scrolling/layout shifts
                this.pendingActiveId = activeId;
                if (!this.activeChangeTimer) {
                    const delay = Math.max(this.minActiveChangeInterval - since, 0);
                    this.activeChangeTimer = setTimeout(() => {
                        this.activeChangeTimer = null;
                        if (this.pendingActiveId && this.pendingActiveId !== this.activeTurnId) {
                            this.activeTurnId = this.pendingActiveId;
                            this.updateActiveDotUI();
                            this.lastActiveChangeTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                        }
                        this.pendingActiveId = null;
                    }, delay);
                }
            } else {
                this.activeTurnId = activeId;
                this.updateActiveDotUI();
                this.lastActiveChangeTime = now;
            }
        }
    }

    waitForElement(selector) {
        return new Promise((resolve) => {
            const element = document.querySelector(selector);
            if (element) return resolve(element);
            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    try { observer.disconnect(); } catch { }
                    resolve(el);
                }
            });
            try { observer.observe(document.body, { childList: true, subtree: true }); } catch { }
            // Guard against long-lived observers on wrong pages
            setTimeout(() => { try { observer.disconnect(); } catch { } resolve(null); }, 5000);
        });
    }

    destroy() {
        try { this.mutationObserver?.disconnect(); } catch { }
        try { this.resizeObserver?.disconnect(); } catch { }
        try { this.intersectionObserver?.disconnect(); } catch { }
        this.visibleUserTurns.clear();
        if (this.ui.timelineBar && this.onTimelineBarClick) {
            try { this.ui.timelineBar.removeEventListener('click', this.onTimelineBarClick); } catch { }
        }
        try { window.removeEventListener('storage', this.onStorage); } catch { }
        try { this.ui.timelineBar?.removeEventListener('pointerdown', this.onPointerDown); } catch { }
        try { window.removeEventListener('pointermove', this.onPointerMove); } catch { }
        try { window.removeEventListener('pointerup', this.onPointerUp); } catch { }
        try { window.removeEventListener('pointercancel', this.onPointerCancel); } catch { }
        try { this.ui.timelineBar?.removeEventListener('pointerleave', this.onPointerLeave); } catch { }
        if (this.scrollContainer && this.onScroll) {
            try { this.scrollContainer.removeEventListener('scroll', this.onScroll); } catch { }
        }
        if (this.ui.timelineBar) {
            try { this.ui.timelineBar.removeEventListener('mouseover', this.onTimelineBarOver); } catch { }
            try { this.ui.timelineBar.removeEventListener('mouseout', this.onTimelineBarOut); } catch { }
            try { this.ui.timelineBar.removeEventListener('focusin', this.onTimelineBarFocusIn); } catch { }
            try { this.ui.timelineBar.removeEventListener('focusout', this.onTimelineBarFocusOut); } catch { }
            try { this.ui.timelineBar.removeEventListener('wheel', this.onTimelineWheel); } catch { }
            // Remove hover handlers with stable refs
            try { this.ui.timelineBar?.removeEventListener('pointerenter', this.onBarEnter); } catch { }
            try { this.ui.timelineBar?.removeEventListener('pointerleave', this.onBarLeave); } catch { }
            try { this.ui.slider?.removeEventListener('pointerenter', this.onSliderEnter); } catch { }
            try { this.ui.slider?.removeEventListener('pointerleave', this.onSliderLeave); } catch { }
            this.onBarEnter = this.onBarLeave = this.onSliderEnter = this.onSliderLeave = null;
        }
        try { this.ui.sliderHandle?.removeEventListener('pointerdown', this.onSliderDown); } catch { }
        try { window.removeEventListener('pointermove', this.onSliderMove); } catch { }
        if (this.onWindowResize) {
            try { window.removeEventListener('resize', this.onWindowResize); } catch { }
        }
        if (this.onVisualViewportResize && window.visualViewport) {
            try { window.visualViewport.removeEventListener('resize', this.onVisualViewportResize); } catch { }
            this.onVisualViewportResize = null;
        }
        if (this.scrollRafId !== null) {
            try { cancelAnimationFrame(this.scrollRafId); } catch { }
            this.scrollRafId = null;
        }
        const explainHandlers = this.selectionExplainHandlers || {};
        try { document.removeEventListener('mouseup', explainHandlers.onMouseUp); } catch { }
        try { document.removeEventListener('keyup', explainHandlers.onKeyUp); } catch { }
        try { document.removeEventListener('selectionchange', explainHandlers.onSelectionChange); } catch { }
        try { document.removeEventListener('pointerdown', explainHandlers.onPointerDown, true); } catch { }
        try { document.removeEventListener('click', explainHandlers.onOutsideClick, true); } catch { }
        if (this.scrollContainer && explainHandlers.onScroll) {
            try { this.scrollContainer.removeEventListener('scroll', explainHandlers.onScroll); } catch { }
        }
        try { window.removeEventListener('scroll', explainHandlers.onWindowScroll); } catch { }
        try { window.removeEventListener('resize', explainHandlers.onResize); } catch { }
        const explainState = this.selectionExplainState || {};
        if (explainState.button) {
            try { explainState.button.remove(); } catch { }
        }
        if (explainState.popup) {
            try { explainState.popup.remove(); } catch { }
        }
        try { explainState.modelButtons?.clear(); } catch { }
        this.selectionExplainInitialized = false;
        this.selectionExplainPositionRaf = null;
        try { this.ui.timelineBar?.remove(); } catch { }
        try { this.ui.tooltip?.remove(); } catch { }
        try { this.measureEl?.remove(); } catch { }
        // Ensure external left slider is fully removed and not intercepting pointer events
        try {
            if (this.ui.slider) {
                try { this.ui.slider.style.pointerEvents = 'none'; } catch { }
                try { this.ui.slider.remove(); } catch { }
            }
            const straySlider = document.querySelector('.timeline-left-slider');
            if (straySlider) {
                try { straySlider.style.pointerEvents = 'none'; } catch { }
                try { straySlider.remove(); } catch { }
            }
        } catch { }
        this.ui.slider = null;
        this.ui.sliderHandle = null;
        this.ui = { timelineBar: null, tooltip: null };
        this.markers = [];
        this.activeTurnId = null;
        this.scrollContainer = null;
        this.conversationContainer = null;
        this.onTimelineBarClick = null;
        this.onTimelineBarOver = null;
        this.onTimelineBarOut = null;
        this.onTimelineBarFocusIn = null;
        this.onTimelineBarFocusOut = null;
        this.onScroll = null;
        this.onWindowResize = null;
        if (this.activeChangeTimer) {
            try { clearTimeout(this.activeChangeTimer); } catch { }
            this.activeChangeTimer = null;
        }
        if (this.tooltipHideTimer) {
            try { clearTimeout(this.tooltipHideTimer); } catch { }
            this.tooltipHideTimer = null;
        }

        if (this.sliderFadeTimer) { try { clearTimeout(this.sliderFadeTimer); } catch { } this.sliderFadeTimer = null; }
        this.pendingActiveId = null;
    }

    // --- Star/Highlight helpers ---
    extractConversationIdFromPath(pathname = location.pathname) {
        try {
            const segs = String(pathname || '').split('/').filter(Boolean);
            const i = segs.indexOf('c');
            if (i === -1) return null;
            const slug = segs[i + 1];
            if (slug && /^[A-Za-z0-9_-]+$/.test(slug)) return slug;
            return null;
        } catch { return null; }
    }

    loadStars() {
        this.starred.clear();
        const cid = this.conversationId;
        if (!cid) return;
        try {
            const raw = localStorage.getItem(`chatgptTimelineStars:${ cid } `);
            if (!raw) return;
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) arr.forEach(id => this.starred.add(String(id)));
        } catch { }
    }

    saveStars() {
        const cid = this.conversationId;
        if (!cid) return;
        try { localStorage.setItem(`chatgptTimelineStars:${ cid } `, JSON.stringify(Array.from(this.starred))); } catch { }
    }

    toggleStar(turnId) {
        const id = String(turnId || '');
        if (!id) return;
        if (this.starred.has(id)) this.starred.delete(id); else this.starred.add(id);
        this.saveStars();
        const m = this.markerMap.get(id);
        if (m) {
            m.starred = this.starred.has(id);
            if (m.dotElement) {
                try {
                    m.dotElement.classList.toggle('starred', m.starred);
                    m.dotElement.setAttribute('aria-pressed', m.starred ? 'true' : 'false');
                } catch { }
                // If tooltip is visible and anchored to this dot, update immediately
                try { this.refreshTooltipForDot(m.dotElement); } catch { }
            }
        }
    }

    cancelLongPress() {
        if (this.longPressTimer) { try { clearTimeout(this.longPressTimer); } catch { } this.longPressTimer = null; }
        if (this.pressTargetDot) { try { this.pressTargetDot.classList.remove('holding'); } catch { } }
        this.pressTargetDot = null;
        this.pressStartPos = null;
        this.longPressTriggered = false;
    }
}


// --- Entry Point and SPA Navigation Handler ---
let timelineManagerInstance = null;
let currentUrl = location.href;
let initTimerId = null;            // cancellable delayed init
let pageObserver = null;           // page-level MutationObserver (managed)
let routeCheckIntervalId = null;   // lightweight href polling fallback
let routeListenersAttached = false;
let timelineActive = true;         // global on/off
let providerEnabled = true;        // per-provider on/off (chatgpt)

// Accept both /c/<id> and nested routes like /g/.../c/<id>
function isConversationRoute(pathname = location.pathname) {
    // Split path into segments and ensure there's an independent "c" segment
    const segs = pathname.split('/').filter(Boolean);
    const i = segs.indexOf('c');
    if (i === -1) return false;           // no "c" segment → not a conversation route
    const slug = segs[i + 1];             // the segment right after "c" must exist
    // Lightweight validity check: allow letters/digits/_/-
    return typeof slug === 'string' && slug.length > 0 && /^[A-Za-z0-9_-]+$/.test(slug);
}

function attachRouteListenersOnce() {
    if (routeListenersAttached) return;
    routeListenersAttached = true;
    try { window.addEventListener('popstate', handleUrlChange); } catch { }
    try { window.addEventListener('hashchange', handleUrlChange); } catch { }
    // Lightweight polling fallback for pushState-driven SPA changes
    try {
        routeCheckIntervalId = setInterval(() => {
            if (location.href !== currentUrl) handleUrlChange();
        }, 800);
    } catch { }
}

function detachRouteListeners() {
    if (!routeListenersAttached) return;
    routeListenersAttached = false;
    try { window.removeEventListener('popstate', handleUrlChange); } catch { }
    try { window.removeEventListener('hashchange', handleUrlChange); } catch { }
    try { if (routeCheckIntervalId) { clearInterval(routeCheckIntervalId); routeCheckIntervalId = null; } } catch { }
}

function cleanupGlobalObservers() {
    try { pageObserver?.disconnect(); } catch { }
    pageObserver = null;
}

function initializeTimeline() {
    if (timelineManagerInstance) {
        try { timelineManagerInstance.destroy(); } catch { }
        timelineManagerInstance = null;
    }
    // Remove any leftover UI before creating a new instance
    try { document.querySelector('.chatgpt-timeline-bar')?.remove(); } catch { }
    try { document.querySelector('.timeline-left-slider')?.remove(); } catch { }
    try { document.getElementById('chatgpt-timeline-tooltip')?.remove(); } catch { }
    timelineManagerInstance = new TimelineManager();
    timelineManagerInstance.init().catch(err => console.error("Timeline initialization failed:", err));
}

function handleUrlChange() {
    if (location.href === currentUrl) return;
    currentUrl = location.href;

    // Cancel any pending init from previous route
    try { if (initTimerId) { clearTimeout(initTimerId); initTimerId = null; } } catch { }

    if (isConversationRoute() && (timelineActive && providerEnabled)) {
        // Delay slightly to allow DOM to settle; re-check path before init
        initTimerId = setTimeout(() => {
            initTimerId = null;
            if (isConversationRoute() && (timelineActive && providerEnabled)) initializeTimeline();
        }, 300);
    } else {
        if (timelineManagerInstance) {
            try { timelineManagerInstance.destroy(); } catch { }
            timelineManagerInstance = null;
        }
        try { document.querySelector('.chatgpt-timeline-bar')?.remove(); } catch { }
        try { document.querySelector('.timeline-left-slider')?.remove(); } catch { }
        try { document.getElementById('chatgpt-timeline-tooltip')?.remove(); } catch { }
        cleanupGlobalObservers();
    }
}

const initialObserver = new MutationObserver(() => {
    if (document.querySelector('article[data-turn-id]')) {
        if (isConversationRoute() && (timelineActive && providerEnabled)) { initializeTimeline(); }
        try { initialObserver.disconnect(); } catch { }
        // Create a single managed pageObserver
        pageObserver = new MutationObserver(handleUrlChange);
        try { pageObserver.observe(document.body, { childList: true, subtree: true }); } catch { }
        attachRouteListenersOnce();
    }
});
try { initialObserver.observe(document.body, { childList: true, subtree: true }); } catch { }

// Read initial toggles (new keys only) and react to changes
try {
    if (chrome?.storage?.local) {
        chrome.storage.local.get({ timelineActive: true, timelineProviders: {} }, (res) => {
            try { timelineActive = !!res.timelineActive; } catch { timelineActive = true; }
            try {
                const map = res.timelineProviders || {};
                providerEnabled = (typeof map.chatgpt === 'boolean') ? map.chatgpt : true;
            } catch { providerEnabled = true; }

            const enabled = timelineActive && providerEnabled;
            if (!enabled) {
                if (timelineManagerInstance) { try { timelineManagerInstance.destroy(); } catch { } timelineManagerInstance = null; }
                try { document.querySelector('.chatgpt-timeline-bar')?.remove(); } catch { }
                try { document.querySelector('.timeline-left-slider')?.remove(); } catch { }
                try { document.getElementById('chatgpt-timeline-tooltip')?.remove(); } catch { }
            } else {
                if (isConversationRoute() && document.querySelector('article[data-turn-id]')) {
                    initializeTimeline();
                }
            }
        });
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes) return;
            let changed = false;
            if ('timelineActive' in changes) {
                timelineActive = !!changes.timelineActive.newValue;
                changed = true;
            }
            if ('timelineProviders' in changes) {
                try {
                    const map = changes.timelineProviders.newValue || {};
                    providerEnabled = (typeof map.chatgpt === 'boolean') ? map.chatgpt : true;
                    changed = true;
                } catch { }
            }
            if (!changed) return;
            const enabled = timelineActive && providerEnabled;
            if (!enabled) {
                if (timelineManagerInstance) { try { timelineManagerInstance.destroy(); } catch { } timelineManagerInstance = null; }
                try { document.querySelector('.chatgpt-timeline-bar')?.remove(); } catch { }
                try { document.querySelector('.timeline-left-slider')?.remove(); } catch { }
                try { document.getElementById('chatgpt-timeline-tooltip')?.remove(); } catch { }
            } else {
                if (isConversationRoute() && document.querySelector('article[data-turn-id]')) {
                    initializeTimeline();
                }
            }
        });
    }
} catch { }
